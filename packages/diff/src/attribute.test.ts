import { digest } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { buildManifest, inputPackage } from '@dumpscan/lockfiles';
import type { InputManifest } from '@dumpscan/lockfiles';
import { findingsRoot } from '@dumpscan/match';
import type { Finding } from '@dumpscan/match';
import { parseAdvisory } from '@dumpscan/osv';
import type { OsvAdvisory } from '@dumpscan/osv';
import type { ScanPredicate } from '@dumpscan/predicate';
import { describe, expect, it } from 'vitest';

import { diffScans, keyOf } from './attribute.js';
import type { DiffInput } from './attribute.js';

const encoder = new TextEncoder();
const d = (text: string): Digest => digest(encoder.encode(text));

function manifest(packages: [string, string][]): InputManifest {
  return buildManifest({
    format: 'test',
    lockfileDigest: d('lockfile'),
    workspaceRoot: '.',
    overApproximated: false,
    packages: packages.map(([name, version]) => inputPackage('npm', name, version)),
    unresolved: [],
  });
}

function finding(part: Partial<Finding> = {}): Finding {
  return {
    ecosystem: 'npm',
    name: 'widget',
    version: '1.0.0',
    purl: 'pkg:npm/widget@1.0.0',
    advisoryId: 'DUMPSCAN-1',
    advisoryModified: '2025-01-01T00:00:00Z',
    advisoryDigest: d('advisory-v1'),
    matchedRange: {
      type: 'SEMVER',
      introduced: '0',
      fixed: '2.0.0',
      lastAffected: null,
      limit: null,
    },
    aliases: [],
    severity: [],
    status: 'affected',
    reason: null,
    ...part,
  };
}

function scan(
  part: Partial<ScanPredicate>,
  packages: [string, string][],
  findings: readonly Finding[],
  advisories?: ReadonlyMap<Digest, OsvAdvisory>,
): DiffInput {
  return {
    predicate: {
      feedDigest: d('feed-1'),
      snapshotManifestDigest: d('snapshot-1'),
      matcherVersion: '0.1.0',
      comparatorRulesetDigest: d('ruleset-1'),
      exclusionsDigest: null,
      findingsRoot: findingsRoot(findings),
      findingsCount: findings.length,
      ecosystems: ['npm'],
      ...part,
    },
    manifest: manifest(packages),
    findings,
    ...(advisories === undefined ? {} : { advisories }),
  };
}

describe('diffScans with nothing changed', () => {
  it('reports every digest as the same and no changes', () => {
    const before = scan({}, [['widget', '1.0.0']], [finding()]);
    const result = diffScans(before, scan({}, [['widget', '1.0.0']], [finding()]));
    expect(result.changes).toStrictEqual([]);
    expect(result.unexplained).toBe(0);
    expect(Object.values(result.digests).every((change) => !change.moved)).toBe(true);
  });
});

describe('diffScans attributing to the input', () => {
  it('attributes a finding that disappeared with its package', () => {
    const before = scan({}, [['widget', '1.0.0']], [finding()]);
    const after = scan({}, [['widget', '2.0.0']], []);
    const result = diffScans(before, after);

    expect(result.digests.input.moved).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.cause).toBe('input');
    expect(result.changes[0]?.kind).toBe('removed');
    expect(result.changes[0]?.evidence['versionsAfter']).toStrictEqual(['2.0.0']);
    expect(result.unexplained).toBe(0);
  });

  it('attributes a finding that appeared with its package', () => {
    const upgraded = finding({ version: '1.5.0', purl: 'pkg:npm/widget@1.5.0' });
    const result = diffScans(
      scan({}, [['widget', '0.1.0']], []),
      scan({}, [['widget', '1.5.0']], [upgraded]),
    );
    expect(result.changes[0]?.cause).toBe('input');
    expect(result.changes[0]?.kind).toBe('added');
  });

  it('attributes both halves of a version bump to the input', () => {
    const result = diffScans(
      scan({}, [['widget', '1.0.0']], [finding()]),
      scan(
        {},
        [['widget', '1.5.0']],
        [finding({ version: '1.5.0', purl: 'pkg:npm/widget@1.5.0' })],
      ),
    );
    expect(result.changes).toHaveLength(2);
    expect(result.changes.every((change) => change.cause === 'input')).toBe(true);
  });
});

describe('diffScans attributing to the exclusions', () => {
  it('attributes a finding that became excluded', () => {
    const excluded = finding({ status: 'excluded', reason: 'excluded by DUMPSCAN-1: mitigated' });
    const result = diffScans(
      scan({}, [['widget', '1.0.0']], [finding()]),
      scan({ exclusionsDigest: d('exclusions') }, [['widget', '1.0.0']], [excluded]),
    );
    expect(result.digests.exclusions.moved).toBe(true);
    expect(result.changes[0]?.cause).toBe('exclusions');
    expect(result.changes[0]?.evidence['statusAfter']).toBe('excluded');
  });

  it('attributes a finding that stopped being excluded', () => {
    const excluded = finding({ status: 'excluded', reason: 'expired' });
    const result = diffScans(
      scan({ exclusionsDigest: d('exclusions') }, [['widget', '1.0.0']], [excluded]),
      scan({}, [['widget', '1.0.0']], [finding()]),
    );
    expect(result.changes[0]?.cause).toBe('exclusions');
    expect(result.changes[0]?.evidence['statusBefore']).toBe('excluded');
  });
});

describe('diffScans attributing to the feed', () => {
  const record = (fixed: string, modified: string): OsvAdvisory =>
    parseAdvisory(
      {
        id: 'DUMPSCAN-1',
        modified,
        affected: [
          {
            package: { ecosystem: 'npm', name: 'widget' },
            ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed }] }],
          },
        ],
      },
      'test',
    );

  it('attributes a finding whose advisory record moved', () => {
    const after = finding({
      advisoryDigest: d('advisory-v2'),
      advisoryModified: '2025-06-01T00:00:00Z',
    });
    const result = diffScans(
      scan({}, [['widget', '1.0.0']], [finding()]),
      scan({ feedDigest: d('feed-2') }, [['widget', '1.0.0']], [after]),
    );
    expect(result.digests.feed.moved).toBe(true);
    expect(result.changes[0]?.cause).toBe('feed');
    expect(result.changes[0]?.evidence['advisoryModifiedAfter']).toBe('2025-06-01T00:00:00Z');
    expect(result.changes[0]?.evidence['recordDiff']).toBeUndefined();
  });

  it('shows the record diff when both snapshots are available', () => {
    const before = scan(
      {},
      [['widget', '1.0.0']],
      [finding()],
      new Map([[d('advisory-v1'), record('2.0.0', '2025-01-01T00:00:00Z')]]),
    );
    const after = scan(
      { feedDigest: d('feed-2') },
      [['widget', '1.0.0']],
      [finding({ advisoryDigest: d('advisory-v2'), advisoryModified: '2025-06-01T00:00:00Z' })],
      new Map([[d('advisory-v2'), record('3.0.0', '2025-06-01T00:00:00Z')]]),
    );

    const result = diffScans(before, after);
    const paths = (result.changes[0]?.evidence['recordDiff'] as { path: string }[]).map(
      (entry) => entry.path,
    );
    expect(paths).toContain('/modified');
    expect(paths.some((path) => path.includes('ranges'))).toBe(true);
  });

  it('attributes an advisory that only exists on one side', () => {
    const result = diffScans(
      scan({}, [['widget', '1.0.0']], []),
      scan({ feedDigest: d('feed-2') }, [['widget', '1.0.0']], [finding()]),
    );
    expect(result.changes[0]?.cause).toBe('feed');
    expect(result.changes[0]?.evidence['presentBefore']).toBe(false);
  });
});

describe('diffScans attributing to the comparators', () => {
  it('attributes a finding that changed with only the ruleset moving', () => {
    const after = finding({
      matchedRange: {
        type: 'SEMVER',
        introduced: '0',
        fixed: '3.0.0',
        lastAffected: null,
        limit: null,
      },
    });
    const result = diffScans(
      scan({}, [['widget', '1.0.0']], [finding()]),
      scan({ comparatorRulesetDigest: d('ruleset-2') }, [['widget', '1.0.0']], [after]),
    );
    expect(result.changes[0]?.cause).toBe('comparator');
    expect(result.changes[0]?.evidence['note']).toMatch(/re-run this comparison/);
  });
});

describe('diffScans with several causes at once', () => {
  it('gives each change the most specific cause that applies', () => {
    const before = scan(
      {},
      [
        ['widget', '1.0.0'],
        ['other', '1.0.0'],
      ],
      [
        finding(),
        finding({ name: 'other', purl: 'pkg:npm/other@1.0.0', advisoryId: 'DUMPSCAN-2' }),
      ],
    );
    const after = scan(
      { feedDigest: d('feed-2'), exclusionsDigest: d('exclusions') },
      [
        ['widget', '2.0.0'],
        ['other', '1.0.0'],
      ],
      [
        finding({
          name: 'other',
          purl: 'pkg:npm/other@1.0.0',
          advisoryId: 'DUMPSCAN-2',
          status: 'excluded',
          reason: 'excluded by DUMPSCAN-2: mitigated',
        }),
      ],
    );

    const result = diffScans(before, after);
    const byKey = new Map(result.changes.map((change) => [change.key, change.cause]));
    expect(byKey.get('npm widget 1.0.0 DUMPSCAN-1')).toBe('input');
    expect(byKey.get('npm other 1.0.0 DUMPSCAN-2')).toBe('exclusions');
    expect(result.unexplained).toBe(0);
  });
});

describe('diffScans with nothing to attribute to', () => {
  it('flags a change no moved digest explains', () => {
    const after = finding({ status: 'withdrawn-suppressed', reason: 'withdrawn' });
    const result = diffScans(
      scan({}, [['widget', '1.0.0']], [finding()]),
      scan({}, [['widget', '1.0.0']], [after]),
    );
    expect(result.changes[0]?.cause).toBe('unexplained');
    expect(result.unexplained).toBe(1);
  });
});

describe('keyOf', () => {
  it('identifies a finding by package version and advisory', () => {
    expect(keyOf(finding())).toBe('npm widget 1.0.0 DUMPSCAN-1');
  });
});
