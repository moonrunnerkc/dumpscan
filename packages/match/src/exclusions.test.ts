import { parseJson } from '@dumpscan/canon';
import type { JsonValue } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import {
  activeExclusions,
  compareInstants,
  EXCLUSIONS_VERSION,
  exclusionsToJson,
  parseExclusions,
} from './exclusions.js';
import type { Exclusion } from './exclusions.js';

const REACHABILITY = {
  advisoryId: 'GHSA-aaaa',
  purl: 'pkg:npm/widget@1.0.0',
  justification: 'not reachable',
};

const MITIGATED = {
  advisoryId: 'GHSA-bbbb',
  justification: 'mitigated at the edge',
  expires: '2099-01-01T00:00:00Z',
};

const DUMPSCAN: JsonValue = { exclusions: [MITIGATED, REACHABILITY] };

const OPENVEX: JsonValue = {
  '@context': 'https://openvex.dev/ns/v0.2.0',
  '@id': 'https://example.invalid/vex/1',
  author: 'Sample',
  timestamp: '2026-01-01T00:00:00Z',
  version: 1,
  statements: [
    {
      vulnerability: { name: 'CVE-2025-1' },
      products: [{ '@id': 'pkg:npm/widget@1.0.0' }, { '@id': 'pkg:npm/other@2.0.0' }],
      status: 'not_affected',
      justification: 'vulnerable_code_not_in_execute_path',
    },
    { vulnerability: { name: 'CVE-2025-2' }, status: 'under_investigation' },
    { vulnerability: 'CVE-2025-3', status: 'not_affected', impact_statement: 'behind a proxy' },
    { vulnerability: { name: 'CVE-2025-4' }, status: 'not_affected' },
  ],
};

describe('parseExclusions on the dumpscan format', () => {
  const parsed = parseExclusions(DUMPSCAN, 'exclusions.json');

  it('reads every entry and sorts them by advisory', () => {
    expect(parsed.source).toBe('dumpscan');
    expect(parsed.exclusions.map((exclusion) => exclusion.advisoryId)).toStrictEqual([
      'GHSA-aaaa',
      'GHSA-bbbb',
    ]);
  });

  it('records an absent purl as null, meaning every package', () => {
    expect(parsed.exclusions[1]?.purl).toBeNull();
    expect(parsed.exclusions[0]?.purl).toBe('pkg:npm/widget@1.0.0');
  });

  it('reports whether anything expires, which is what puts a time in the predicate', () => {
    expect(parsed.hasExpiry).toBe(true);
    expect(parseExclusions({ exclusions: [REACHABILITY] }, 'x').hasExpiry).toBe(false);
  });

  it('breaks ties by purl and then by expiry, so the order never depends on the file', () => {
    const sameAdvisory = {
      exclusions: [
        { advisoryId: 'a', purl: 'pkg:npm/z@1.0.0', justification: 'j' },
        { advisoryId: 'a', purl: 'pkg:npm/a@1.0.0', justification: 'j' },
        { advisoryId: 'a', justification: 'j' },
      ],
    };
    expect(parseExclusions(sameAdvisory, 'x').exclusions.map((e) => e.purl)).toStrictEqual([
      null,
      'pkg:npm/a@1.0.0',
      'pkg:npm/z@1.0.0',
    ]);

    const sameAdvisoryAndPurl = {
      exclusions: [
        { advisoryId: 'a', justification: 'j', expires: '2030-01-01T00:00:00Z' },
        { advisoryId: 'a', justification: 'j', expires: '2027-01-01T00:00:00Z' },
        { advisoryId: 'a', justification: 'j' },
      ],
    };
    expect(
      parseExclusions(sameAdvisoryAndPurl, 'x').exclusions.map((e) => e.expires),
    ).toStrictEqual([null, '2027-01-01T00:00:00Z', '2030-01-01T00:00:00Z']);
  });

  it('hashes the parsed exclusions, not the file, so reformatting does not move the digest', () => {
    const reordered = { exclusions: [REACHABILITY, MITIGATED] };
    expect(parseExclusions(reordered, 'x').digest).toBe(parsed.digest);
  });

  it('moves the digest when an entry is added or its justification changes', () => {
    expect(parseExclusions({ exclusions: [] }, 'x').digest).not.toBe(parsed.digest);
    const changed = { exclusions: [{ ...MITIGATED, justification: 'different' }, REACHABILITY] };
    expect(parseExclusions(changed, 'x').digest).not.toBe(parsed.digest);
  });

  it('refuses an entry with no advisory or no justification', () => {
    expect(() => parseExclusions({ exclusions: [{ justification: 'x' }] }, 'e')).toThrow(
      /exclusions\[0\] advisoryId is missing/,
    );
    expect(() => parseExclusions({ exclusions: [{ advisoryId: 'a' }] }, 'e')).toThrow(
      /exclusions\[0\] justification is missing/,
    );
    expect(() => parseExclusions({ exclusions: ['x'] }, 'e')).toThrow(
      /exclusions\[0\] is not a JSON object/,
    );
  });

  it('refuses an expiry that two machines could read differently', () => {
    expect(() =>
      parseExclusions(
        { exclusions: [{ advisoryId: 'a', justification: 'b', expires: '2026-01-01' }] },
        'e',
      ),
    ).toThrow(/e exclusions\[0\] expires is "2026-01-01"; an expiry has to be an RFC 3339 instant/);
  });
});

describe('parseExclusions on OpenVEX', () => {
  const parsed = parseExclusions(OPENVEX, 'openvex.json');

  it('reads only the not_affected statements', () => {
    expect(parsed.source).toBe('openvex');
    expect([...new Set(parsed.exclusions.map((exclusion) => exclusion.advisoryId))]).toStrictEqual([
      'CVE-2025-1',
      'CVE-2025-3',
      'CVE-2025-4',
    ]);
  });

  it('makes one exclusion per product', () => {
    const first = parsed.exclusions.filter((exclusion) => exclusion.advisoryId === 'CVE-2025-1');
    expect(first.map((exclusion) => exclusion.purl)).toStrictEqual([
      'pkg:npm/other@2.0.0',
      'pkg:npm/widget@1.0.0',
    ]);
  });

  it('applies to every package when a statement names no product', () => {
    expect(parsed.exclusions.find((e) => e.advisoryId === 'CVE-2025-4')?.purl).toBeNull();
  });

  it('accepts a vulnerability written as a bare string', () => {
    expect(parsed.exclusions.find((e) => e.advisoryId === 'CVE-2025-3')?.justification).toBe(
      'behind a proxy',
    );
  });

  it('never gives an OpenVEX statement an expiry, because OpenVEX has none', () => {
    expect(parsed.hasExpiry).toBe(false);
  });
});

describe('parseExclusions failures', () => {
  it('refuses a document that is neither shape', () => {
    expect(() => parseExclusions({ ignore: [] }, 'e')).toThrow(
      /neither an exclusions array nor an OpenVEX statements array/,
    );
    expect(() => parseExclusions([], 'e')).toThrow(/is not a JSON object/);
  });
});

describe('exclusionsToJson', () => {
  it('renders the version tag and every field', () => {
    const json = exclusionsToJson('dumpscan', parseExclusions(DUMPSCAN, 'x').exclusions);
    expect(json['exclusionsVersion']).toBe('dumpscan.exclusions/v1');
    expect(EXCLUSIONS_VERSION).toBe('dumpscan.exclusions/v1');
    expect(Object.keys(json).sort((a, b) => (a < b ? -1 : 1))).toStrictEqual([
      'exclusions',
      'exclusionsVersion',
      'source',
    ]);
  });
});

describe('activeExclusions', () => {
  const exclusions: Exclusion[] = [
    { advisoryId: 'a', purl: null, justification: 'x', expires: null },
    { advisoryId: 'b', purl: null, justification: 'x', expires: '2026-06-01T00:00:00Z' },
  ];

  it('keeps an exclusion that never expires', () => {
    expect(
      activeExclusions(exclusions, '2099-01-01T00:00:00Z').map((e) => e.advisoryId),
    ).toStrictEqual(['a']);
  });

  it('keeps an exclusion whose expiry is still ahead', () => {
    expect(activeExclusions(exclusions, '2026-01-01T00:00:00Z')).toHaveLength(2);
  });

  it('drops one exactly at its expiry, so the boundary is not a grace period', () => {
    expect(activeExclusions(exclusions, '2026-06-01T00:00:00Z')).toHaveLength(1);
  });
});

describe('compareInstants', () => {
  it('orders RFC 3339 Zulu instants without a clock or a Date', () => {
    expect(compareInstants('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toBeLessThan(0);
    expect(compareInstants('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(0);
    expect(compareInstants('2027-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBeGreaterThan(0);
  });
});

describe('the fixture exclusions', () => {
  it('parse and produce a stable digest', () => {
    const dumpscan = parseExclusions(
      parseJson(JSON.stringify(DUMPSCAN)),
      'fixtures/exclusions/dumpscan.exclusions.json',
    );
    expect(dumpscan.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
