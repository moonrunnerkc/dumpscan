import type { JsonValue } from '@dumpscan/canon';
import { buildManifest, inputPackage, ROOT_WORKSPACE } from '@dumpscan/lockfiles';
import type { InputManifest, InputPackage } from '@dumpscan/lockfiles';
import { memoryAdvisorySource, parseAdvisory } from '@dumpscan/osv';
import type { AdvisorySource, Ecosystem, OsvAdvisory } from '@dumpscan/osv';
import { describe, expect, it } from 'vitest';

import { MATCHER_VERSION, matchManifest } from './engine.js';

const DIGEST = `sha256:${'0'.repeat(64)}` as const;

function manifest(packages: InputPackage[]): InputManifest {
  return buildManifest({
    format: 'test',
    lockfileDigest: DIGEST,
    workspaceRoot: ROOT_WORKSPACE,
    overApproximated: false,
    packages,
    unresolved: ['a-git-dependency'],
  });
}

function advisory(id: string, affected: JsonValue): OsvAdvisory {
  return parseAdvisory({ id, modified: '2025-01-01T00:00:00Z', affected }, 'test');
}

function source(entries: [Ecosystem, string, OsvAdvisory[]][]): AdvisorySource {
  const byEcosystem = new Map<Ecosystem, Map<string, readonly OsvAdvisory[]>>();
  for (const [ecosystem, name, advisories] of entries) {
    const bucket = byEcosystem.get(ecosystem) ?? new Map<string, readonly OsvAdvisory[]>();
    bucket.set(name, advisories);
    byEcosystem.set(ecosystem, bucket);
  }
  return memoryAdvisorySource(byEcosystem);
}

const widgetAdvisory = advisory('DUMPSCAN-A', [
  {
    package: { ecosystem: 'npm', name: 'Widget' },
    ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '2.0.0' }] }],
  },
]);

const otherAdvisory = advisory('DUMPSCAN-B', [
  {
    package: { ecosystem: 'npm', name: 'Widget' },
    ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '3.0.0' }] }],
  },
]);

describe('matchManifest', () => {
  it('looks packages up under their normalized name', () => {
    const result = matchManifest(
      manifest([inputPackage('npm', 'Widget', '1.0.0')]),
      source([['npm', 'widget', [widgetAdvisory]]]),
    );
    expect(result.findings.map((finding) => finding.advisoryId)).toStrictEqual(['DUMPSCAN-A']);
    expect(result.findings[0]?.name).toBe('Widget');
  });

  it('normalizes PyPI names per PEP 503 before the lookup', () => {
    const pypiAdvisory = advisory('DUMPSCAN-P', [
      {
        package: { ecosystem: 'PyPI', name: 'Sample_Client' },
        ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '3.0' }] }],
      },
    ]);
    const result = matchManifest(
      manifest([inputPackage('PyPI', 'sample.client', '2.0')]),
      source([['PyPI', 'sample-client', [pypiAdvisory]]]),
    );
    expect(result.findings).toHaveLength(1);
  });

  it('reports every advisory that matches a package', () => {
    const result = matchManifest(
      manifest([inputPackage('npm', 'Widget', '1.0.0')]),
      source([['npm', 'widget', [widgetAdvisory, otherAdvisory]]]),
    );
    expect(result.findings.map((finding) => finding.advisoryId)).toStrictEqual([
      'DUMPSCAN-A',
      'DUMPSCAN-B',
    ]);
  });

  it('keeps the finding when only one advisory matches, rather than dropping it', () => {
    const result = matchManifest(
      manifest([inputPackage('npm', 'Widget', '1.0.0')]),
      source([['npm', 'widget', [widgetAdvisory]]]),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.advisoryId).toBe('DUMPSCAN-A');
  });

  it('reports one finding when the same advisory is indexed twice', () => {
    const result = matchManifest(
      manifest([inputPackage('npm', 'Widget', '1.0.0')]),
      source([['npm', 'widget', [widgetAdvisory, widgetAdvisory]]]),
    );
    expect(result.findings).toHaveLength(1);
  });

  it('reports the same findings whatever order the packages are in', () => {
    const packages = [
      inputPackage('npm', 'Widget', '1.0.0'),
      inputPackage('npm', 'widget', '1.5.0'),
    ];
    const advisories = source([['npm', 'widget', [widgetAdvisory]]]);
    const forward = matchManifest(manifest(packages), advisories);
    const reversed = matchManifest(manifest([...packages].reverse()), advisories);
    expect(reversed.findingsRoot).toBe(forward.findingsRoot);
    expect(reversed.findings).toStrictEqual(forward.findings);
  });

  it('sorts findings by ecosystem, name, version, then advisory', () => {
    const pypiAdvisory = advisory('DUMPSCAN-P', [
      { package: { ecosystem: 'PyPI', name: 'thing' }, versions: ['1.0'] },
    ]);
    const result = matchManifest(
      manifest([inputPackage('npm', 'Widget', '1.0.0'), inputPackage('PyPI', 'thing', '1.0')]),
      source([
        ['npm', 'widget', [widgetAdvisory]],
        ['PyPI', 'thing', [pypiAdvisory]],
      ]),
    );
    expect(result.findings.map((finding) => finding.ecosystem)).toStrictEqual(['PyPI', 'npm']);
  });

  it('reports the ecosystems the manifest asked about, sorted', () => {
    const result = matchManifest(
      manifest([
        inputPackage('npm', 'Widget', '1.0.0'),
        inputPackage('PyPI', 'thing', '1.0'),
        inputPackage('npm', 'other', '1.0.0'),
      ]),
      source([['npm', 'widget', [widgetAdvisory]]]),
    );
    expect(result.ecosystems).toStrictEqual(['PyPI', 'npm']);
  });

  it('reports no findings and the empty root for a manifest with no matches', () => {
    const result = matchManifest(manifest([inputPackage('npm', 'safe', '1.0.0')]), source([]));
    expect(result.findings).toStrictEqual([]);
    expect(result.findingsRoot).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(result.ecosystems).toStrictEqual(['npm']);
  });

  it('produces no findings for packages the parser could not resolve', () => {
    const result = matchManifest(manifest([]), source([['npm', 'widget', [widgetAdvisory]]]));
    expect(result.findings).toStrictEqual([]);
    expect(result.ecosystems).toStrictEqual([]);
  });

  it('refuses to judge an expiry without being told which instant to judge it at', () => {
    expect(() =>
      matchManifest(manifest([inputPackage('npm', 'Widget', '1.0.0')]), source([]), {
        exclusions: [
          { advisoryId: 'a', purl: null, justification: 'j', expires: null },
          { advisoryId: 'b', purl: null, justification: 'j', expires: '2030-01-01T00:00:00Z' },
        ],
      }),
    ).toThrow(/an exclusion has an expiry and no evaluationTime was given/);
  });

  it('needs no evaluation time when nothing expires', () => {
    const result = matchManifest(
      manifest([inputPackage('npm', 'Widget', '1.0.0')]),
      source([['npm', 'widget', [widgetAdvisory]]]),
      { exclusions: [{ advisoryId: 'DUMPSCAN-A', purl: null, justification: 'j', expires: null }] },
    );
    expect(result.findings[0]?.status).toBe('excluded');
  });

  it('applies a purl scoped exclusion only to that package', () => {
    const exclusions = [
      {
        advisoryId: 'DUMPSCAN-A',
        purl: 'pkg:npm/somethingelse@1.0.0',
        justification: 'j',
        expires: null,
      },
    ];
    const result = matchManifest(
      manifest([inputPackage('npm', 'Widget', '1.0.0')]),
      source([['npm', 'widget', [widgetAdvisory]]]),
      { exclusions },
    );
    expect(result.findings[0]?.status).toBe('affected');
  });

  it('stamps the matcher version', () => {
    const result = matchManifest(manifest([]), source([]));
    expect(result.matcherVersion).toBe(MATCHER_VERSION);
    expect(MATCHER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('sorts its output even when the manifest it is handed is not sorted', () => {
    const unsorted: InputManifest = {
      manifestVersion: 'dumpscan.input/v1',
      format: 'test',
      lockfileDigest: DIGEST,
      workspaceRoot: ROOT_WORKSPACE,
      overApproximated: false,
      packages: [inputPackage('npm', 'Widget', '1.0.0'), inputPackage('PyPI', 'thing', '1.0')],
      unresolved: [],
    };
    const pypiAdvisory = advisory('DUMPSCAN-P', [
      { package: { ecosystem: 'PyPI', name: 'thing' }, versions: ['1.0'] },
    ]);
    const result = matchManifest(
      unsorted,
      source([
        ['npm', 'widget', [otherAdvisory, widgetAdvisory]],
        ['PyPI', 'thing', [pypiAdvisory]],
      ]),
    );
    expect(result.ecosystems).toStrictEqual(['PyPI', 'npm']);
    expect(result.findings.map((finding) => finding.advisoryId)).toStrictEqual([
      'DUMPSCAN-P',
      'DUMPSCAN-A',
      'DUMPSCAN-B',
    ]);
  });

  it('gives the same root for two manifests with the same packages', () => {
    const advisories = source([['npm', 'widget', [widgetAdvisory]]]);
    const a = matchManifest(manifest([inputPackage('npm', 'Widget', '1.0.0')]), advisories);
    const b = matchManifest(manifest([inputPackage('npm', 'Widget', '1.0.0')]), advisories);
    expect(b.findingsRoot).toBe(a.findingsRoot);
  });

  it('gives a different root when a version moves out of the range', () => {
    const advisories = source([['npm', 'widget', [widgetAdvisory]]]);
    const vulnerable = matchManifest(
      manifest([inputPackage('npm', 'Widget', '1.0.0')]),
      advisories,
    );
    const fixed = matchManifest(manifest([inputPackage('npm', 'Widget', '2.0.0')]), advisories);
    expect(fixed.findingsRoot).not.toBe(vulnerable.findingsRoot);
    expect(fixed.findings).toStrictEqual([]);
  });
});
