import { canonicalJson } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import {
  compareFindings,
  findingLeafHash,
  findingLeaves,
  findingsRoot,
  findingToJson,
} from './finding.js';
import type { Finding } from './finding.js';

const DIGEST: Digest = `sha256:${'ab'.repeat(32)}`;

function finding(part: Partial<Finding> = {}): Finding {
  return {
    ecosystem: 'npm',
    name: 'widget',
    version: '1.0.0',
    purl: 'pkg:npm/widget@1.0.0',
    advisoryId: 'DUMPSCAN-1',
    advisoryModified: '2025-01-01T00:00:00Z',
    advisoryDigest: DIGEST,
    matchedRange: {
      type: 'SEMVER',
      introduced: '0',
      fixed: '2.0.0',
      lastAffected: null,
      limit: null,
    },
    aliases: ['CVE-2025-1'],
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }],
    status: 'affected',
    reason: null,
    ...part,
  };
}

describe('findingToJson', () => {
  it('renders every field, so a change to any of them moves the root', () => {
    const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    expect(Object.keys(findingToJson(finding())).sort(byName)).toStrictEqual([
      'advisoryDigest',
      'advisoryId',
      'advisoryModified',
      'aliases',
      'ecosystem',
      'matchedRange',
      'name',
      'purl',
      'reason',
      'severity',
      'status',
      'version',
    ]);
  });

  it('renders an absent range as null rather than omitting it', () => {
    expect(findingToJson(finding({ matchedRange: null }))['matchedRange']).toBeNull();
  });

  it('renders the range bounds in full', () => {
    expect(findingToJson(finding())['matchedRange']).toStrictEqual({
      type: 'SEMVER',
      introduced: '0',
      fixed: '2.0.0',
      lastAffected: null,
      limit: null,
    });
  });

  it('canonicalizes to sorted keys with no whitespace', () => {
    const text = canonicalJson(findingToJson(finding({ aliases: [], severity: [] })));
    expect(text.startsWith('{"advisoryDigest":')).toBe(true);
    expect(text).not.toMatch(/\s/);
  });
});

describe('compareFindings', () => {
  it('orders by ecosystem, name, version, advisory, then advisory digest', () => {
    expect(compareFindings(finding({ ecosystem: 'PyPI' }), finding())).toBeLessThan(0);
    expect(compareFindings(finding({ name: 'a' }), finding({ name: 'b' }))).toBeLessThan(0);
    expect(
      compareFindings(finding({ version: '1.0.0' }), finding({ version: '1.0.1' })),
    ).toBeLessThan(0);
    expect(
      compareFindings(finding({ advisoryId: 'A' }), finding({ advisoryId: 'B' })),
    ).toBeLessThan(0);
    expect(
      compareFindings(finding({ advisoryDigest: `sha256:${'00'.repeat(32)}` }), finding()),
    ).toBeLessThan(0);
    expect(compareFindings(finding(), finding())).toBe(0);
  });

  it('orders by code unit rather than by version precedence', () => {
    expect(
      compareFindings(finding({ version: '1.10.0' }), finding({ version: '1.9.0' })),
    ).toBeLessThan(0);
  });
});

describe('findingsRoot', () => {
  it('does not depend on the order the findings arrive in', () => {
    const a = finding({ name: 'a' });
    const b = finding({ name: 'b' });
    expect(findingsRoot([a, b])).toBe(findingsRoot([b, a]));
  });

  it('moves when any field of any finding moves', () => {
    const base = findingsRoot([finding()]);
    expect(findingsRoot([finding({ status: 'excluded' })])).not.toBe(base);
    expect(findingsRoot([finding({ reason: 'because' })])).not.toBe(base);
    expect(findingsRoot([finding({ advisoryModified: '2025-06-01T00:00:00Z' })])).not.toBe(base);
    expect(findingsRoot([finding({ aliases: [] })])).not.toBe(base);
    expect(findingsRoot([finding({ severity: [] })])).not.toBe(base);
  });

  it('moves when a finding is added or removed', () => {
    const one = findingsRoot([finding()]);
    expect(findingsRoot([finding(), finding({ name: 'other' })])).not.toBe(one);
    expect(findingsRoot([])).not.toBe(one);
  });

  it('roots an empty findings set to the empty tree', () => {
    expect(findingsRoot([])).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('findingLeaves', () => {
  it('returns the leaves in tree order, sorted by hash', () => {
    const findings = [finding({ name: 'b' }), finding({ name: 'a' }), finding({ name: 'c' })];
    const leaves = findingLeaves(findings);
    expect(leaves).toHaveLength(3);
    for (let i = 1; i < leaves.length; i += 1) {
      const previous = leaves[i - 1] as Uint8Array;
      const current = leaves[i] as Uint8Array;
      expect([...previous].join()).not.toBe([...current].join());
      expect(Buffer.compare(Buffer.from(previous), Buffer.from(current))).toBeLessThan(0);
    }
  });

  it('contains the leaf of every finding it was given', () => {
    const one = finding({ name: 'only' });
    expect(findingLeaves([one])[0]).toStrictEqual(findingLeafHash(one));
  });
});
