import type { JsonValue } from '@dumpscan/canon';
import { inputPackage } from '@dumpscan/lockfiles';
import type { InputPackage } from '@dumpscan/lockfiles';
import { parseAdvisory } from '@dumpscan/osv';
import type { OsvAdvisory } from '@dumpscan/osv';
import { describe, expect, it } from 'vitest';

import { matchAdvisory } from './advisory-match.js';

const npm = (version: string): InputPackage => inputPackage('npm', 'widget', version);
const pypi = (version: string): InputPackage => inputPackage('PyPI', 'sample-client', version);

function advisory(affected: JsonValue, extra: Record<string, JsonValue> = {}): OsvAdvisory {
  return parseAdvisory(
    { id: 'DUMPSCAN-TEST-1', modified: '2025-01-01T00:00:00Z', affected, ...extra },
    'test',
  );
}

const semverRange = (fixed: string): JsonValue => ({
  type: 'SEMVER',
  events: [{ introduced: '0' }, { fixed }],
});

describe('matchAdvisory', () => {
  it('reports an affected version with the range that matched', () => {
    const finding = matchAdvisory(
      advisory([{ package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] }]),
      npm('1.5.0'),
    );
    expect(finding?.status).toBe('affected');
    expect(finding?.matchedRange).toStrictEqual({
      type: 'SEMVER',
      introduced: '0',
      fixed: '2.0.0',
      lastAffected: null,
      limit: null,
    });
    expect(finding?.reason).toBeNull();
    expect(finding?.advisoryDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('reports nothing when no range covers the version', () => {
    expect(
      matchAdvisory(
        advisory([
          { package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] },
        ]),
        npm('2.0.0'),
      ),
    ).toBeNull();
  });

  it('reports nothing when the advisory covers a different ecosystem', () => {
    expect(
      matchAdvisory(
        advisory([
          { package: { ecosystem: 'PyPI', name: 'widget' }, ranges: [semverRange('2.0.0')] },
        ]),
        npm('1.0.0'),
      ),
    ).toBeNull();
  });

  it('suppresses a withdrawn advisory rather than dropping the finding', () => {
    const finding = matchAdvisory(
      advisory(
        [{ package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] }],
        { withdrawn: '2025-02-19T08:00:00Z' },
      ),
      npm('1.5.0'),
    );
    expect(finding?.status).toBe('withdrawn-suppressed');
    expect(finding?.reason).toBe('advisory was withdrawn at 2025-02-19T08:00:00Z');
    expect(finding?.matchedRange?.fixed).toBe('2.0.0');
  });

  it('does not suppress an unevaluated finding into a withdrawal', () => {
    const finding = matchAdvisory(
      advisory(
        [
          {
            package: { ecosystem: 'npm', name: 'widget' },
            ranges: [{ type: 'GIT', events: [{ introduced: '0' }] }],
          },
        ],
        { withdrawn: '2025-02-19T08:00:00Z' },
      ),
      npm('1.5.0'),
    );
    expect(finding?.status).toBe('unevaluated');
  });

  it('prefers an affected entry over an unevaluated one across entries', () => {
    const finding = matchAdvisory(
      advisory([
        {
          package: { ecosystem: 'npm', name: 'widget' },
          ranges: [{ type: 'GIT', events: [{ introduced: '0' }] }],
        },
        { package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] },
      ]),
      npm('1.5.0'),
    );
    expect(finding?.status).toBe('affected');
  });

  it('matches an explicit versions list exactly', () => {
    const finding = matchAdvisory(
      advisory([{ package: { ecosystem: 'npm', name: 'widget' }, versions: ['1.2.0', '1.4.7'] }]),
      npm('1.4.7'),
    );
    expect(finding?.matchedRange).toStrictEqual({
      type: 'VERSIONS',
      introduced: '1.4.7',
      fixed: null,
      lastAffected: '1.4.7',
      limit: null,
    });
    expect(
      matchAdvisory(
        advisory([{ package: { ecosystem: 'npm', name: 'widget' }, versions: ['1.2.0'] }]),
        npm('1.3.0'),
      ),
    ).toBeNull();
  });

  it('treats two PyPI spellings of the same release as the same version', () => {
    const finding = matchAdvisory(
      advisory([{ package: { ecosystem: 'PyPI', name: 'sample-client' }, versions: ['1.0'] }]),
      pypi('1.0.0'),
    );
    expect(finding?.status).toBe('affected');
  });

  it('falls back to string equality when the comparator cannot read the listed version', () => {
    const finding = matchAdvisory(
      advisory([{ package: { ecosystem: 'npm', name: 'widget' }, versions: ['not-a-version'] }]),
      npm('not-a-version'),
    );
    expect(finding?.status).toBe('affected');
  });

  it('prefers the affected entry severity and falls back to the advisory severity', () => {
    const entrySeverity = matchAdvisory(
      advisory(
        [
          {
            package: { ecosystem: 'npm', name: 'widget' },
            ranges: [semverRange('2.0.0')],
            severity: [{ type: 'CVSS_V4', score: 'entry' }],
          },
        ],
        { severity: [{ type: 'CVSS_V3', score: 'record' }] },
      ),
      npm('1.0.0'),
    );
    expect(entrySeverity?.severity).toStrictEqual([{ type: 'CVSS_V4', score: 'entry' }]);

    const recordSeverity = matchAdvisory(
      advisory(
        [{ package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] }],
        { severity: [{ type: 'CVSS_V3', score: 'record' }] },
      ),
      npm('1.0.0'),
    );
    expect(recordSeverity?.severity).toStrictEqual([{ type: 'CVSS_V3', score: 'record' }]);
  });

  it('carries the advisory id, modified value, aliases, and the package tuple', () => {
    const finding = matchAdvisory(
      advisory(
        [{ package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] }],
        { aliases: ['CVE-2025-1', 'GHSA-x'] },
      ),
      npm('1.0.0'),
    );
    expect(finding?.advisoryId).toBe('DUMPSCAN-TEST-1');
    expect(finding?.advisoryModified).toBe('2025-01-01T00:00:00Z');
    expect(finding?.aliases).toStrictEqual(['CVE-2025-1', 'GHSA-x']);
    expect(finding?.purl).toBe('pkg:npm/widget@1.0.0');
  });

  it('matches an ecosystem written with a suffix', () => {
    const finding = matchAdvisory(
      advisory([
        { package: { ecosystem: 'npm:legacy', name: 'widget' }, ranges: [semverRange('2.0.0')] },
      ]),
      npm('1.0.0'),
    );
    expect(finding?.status).toBe('affected');
  });
});
