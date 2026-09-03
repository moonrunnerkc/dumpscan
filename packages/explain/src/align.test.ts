import { readFileSync } from 'node:fs';

import { digest, parseJson } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { buildManifest, inputPackage } from '@dumpscan/lockfiles';
import type { InputManifest } from '@dumpscan/lockfiles';
import type { Finding } from '@dumpscan/match';
import { describe, expect, it } from 'vitest';

import { explainAgainst, explainToJson } from './align.js';
import { parseExternalReport } from './external.js';

const SCANNERS = new URL('../../../fixtures/scanners', import.meta.url).pathname;
const encoder = new TextEncoder();
const d = (text: string): Digest => digest(encoder.encode(text));

const manifest: InputManifest = buildManifest({
  format: 'package-lock.json v3',
  lockfileDigest: d('lockfile'),
  workspaceRoot: '.',
  overApproximated: false,
  packages: [
    inputPackage('npm', 'cheeseparser', '4.17.20'),
    inputPackage('npm', 'polyglot', '1.9.0'),
    inputPackage('npm', 'tiny-helper', '0.4.2'),
  ],
  unresolved: [],
});

function finding(part: Partial<Finding>): Finding {
  return {
    ecosystem: 'npm',
    name: 'cheeseparser',
    version: '4.17.20',
    purl: 'pkg:npm/cheeseparser@4.17.20',
    advisoryId: 'DUMPSCAN-NPM-0001',
    advisoryModified: '2025-01-14T09:00:00Z',
    advisoryDigest: d('advisory'),
    matchedRange: null,
    aliases: ['CVE-2024-90001', 'GHSA-aaaa-bbbb-cccc'],
    severity: [],
    status: 'affected',
    reason: null,
    ...part,
  };
}

const grype = parseExternalReport(
  parseJson(readFileSync(`${SCANNERS}/grype.json`, 'utf8')),
  'grype.json',
);
const trivy = parseExternalReport(
  parseJson(readFileSync(`${SCANNERS}/trivy.json`, 'utf8')),
  'trivy.json',
);

describe('explainAgainst on the Grype fixture', () => {
  const result = explainAgainst(
    manifest,
    [
      finding({}),
      finding({
        advisoryId: 'DUMPSCAN-NPM-0003',
        aliases: [],
        status: 'withdrawn-suppressed',
        reason: 'advisory was withdrawn at 2025-02-19T08:00:00Z',
      }),
    ],
    grype,
  );

  it('agrees on the advisory both tools have under different identifiers', () => {
    expect(result.agreed).toStrictEqual([
      { purl: 'pkg:npm/cheeseparser@4.17.20', advisory: 'DUMPSCAN-NPM-0001' },
    ]);
  });

  it('buckets a CPE match on a package the manifest does not contain', () => {
    const mismatch = result.discrepancies.find((entry) => entry.bucket === 'identifier-mismatch');
    expect(mismatch?.advisory).toBe('CVE-2019-11111');
    expect(mismatch?.detail).toMatch(/matched node 18.0.0 on cpe-match/);
  });

  it('buckets an advisory the pinned snapshot does not have', () => {
    const feed = result.discrepancies.filter((entry) => entry.bucket === 'feed-difference');
    expect(feed.map((entry) => entry.advisory)).toContain('CVE-2021-22222');
    expect(feed[0]?.detail).toMatch(/the pinned OSV snapshot has no advisory under that id/);
  });

  it('buckets a finding dumpscan suppressed', () => {
    const suppression = result.discrepancies.find((entry) => entry.bucket === 'suppression');
    expect(suppression?.advisory).toBe('DUMPSCAN-NPM-0003');
    expect(suppression?.detail).toMatch(/dumpscan reports it as withdrawn-suppressed/);
  });

  it('counts every bucket', () => {
    expect(result.counts).toStrictEqual({
      'identifier-mismatch': 1,
      'feed-difference': 1,
      'range-interpretation': 0,
      suppression: 1,
    });
  });

  it('names the scanner it read', () => {
    expect(result.scanner).toBe('grype');
  });
});

describe('explainAgainst on the Trivy fixture', () => {
  it('matches through an alias the other tool used as the primary id', () => {
    const result = explainAgainst(manifest, [finding({})], trivy);
    expect(result.agreed).toStrictEqual([
      { purl: 'pkg:npm/cheeseparser@4.17.20', advisory: 'DUMPSCAN-NPM-0001' },
    ]);
    expect(result.scanner).toBe('trivy');
  });

  it('buckets an advisory only the external scanner has', () => {
    const result = explainAgainst(manifest, [finding({})], trivy);
    expect(result.discrepancies.find((entry) => entry.advisory === 'CVE-2020-33333')?.bucket).toBe(
      'feed-difference',
    );
  });
});

describe('explainAgainst on findings only dumpscan has', () => {
  it('calls it a range interpretation when both tools share the advisory', () => {
    const shared = explainAgainst(
      manifest,
      [finding({ version: '4.17.20' })],
      grype.filter(
        (entry) => entry.purl === 'pkg:npm/cheeseparser@4.17.20' && entry.id !== 'CVE-2024-90001',
      ),
    );
    const ours = shared.discrepancies.filter((entry) => entry.side === 'dumpscan-only');
    expect(ours.map((entry) => entry.bucket)).toContain('feed-difference');
  });

  it('calls it a range interpretation when the ids line up but the verdicts do not', () => {
    const externalSame = [
      {
        scanner: 'grype' as const,
        id: 'CVE-2024-90001',
        aliases: [],
        name: 'cheeseparser',
        version: '4.17.20',
        purl: 'pkg:npm/cheeseparser@4.17.20',
        ecosystem: 'npm' as const,
        matchedOn: 'exact-direct-match',
        severity: 'High',
      },
    ];
    const result = explainAgainst(
      manifest,
      [finding({ advisoryId: 'OTHER-1', aliases: ['CVE-2024-90001'] })],
      externalSame,
    );
    expect(result.agreed).toHaveLength(1);
    expect(result.discrepancies).toStrictEqual([]);
  });

  it('reports a finding the external scanner never mentioned as a feed difference', () => {
    const result = explainAgainst(
      manifest,
      [
        finding({
          name: 'tiny-helper',
          purl: 'pkg:npm/tiny-helper@0.4.2',
          advisoryId: 'ONLY-OURS',
          aliases: [],
        }),
      ],
      [],
    );
    expect(result.discrepancies[0]?.bucket).toBe('feed-difference');
    expect(result.discrepancies[0]?.side).toBe('dumpscan-only');
  });

  it('ignores findings that are not affected when looking for ours only', () => {
    const result = explainAgainst(manifest, [finding({ status: 'excluded' })], []);
    expect(result.discrepancies).toStrictEqual([]);
  });
});

describe('explainToJson', () => {
  it('renders the counts and both lists', () => {
    const json = explainToJson(explainAgainst(manifest, [finding({})], grype));
    expect(Object.keys(json).sort((a, b) => (a < b ? -1 : 1))).toStrictEqual([
      'agreed',
      'counts',
      'discrepancies',
      'scanner',
    ]);
  });

  it('reports the scanner as unknown when there is nothing to read it from', () => {
    expect(explainAgainst(manifest, [], []).scanner).toBe('unknown');
  });
});
