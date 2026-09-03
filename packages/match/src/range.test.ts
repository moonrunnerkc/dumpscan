import type { OsvEvent, OsvRange } from '@dumpscan/osv';
import { comparatorByName } from '@dumpscan/versions';
import type { Comparator } from '@dumpscan/versions';
import { describe, expect, it } from 'vitest';

import { evaluateRange, FROM_THE_BEGINNING, rangeVersions, sortEvents } from './range.js';

const semver = comparatorByName('semver') as Comparator;
const pep440 = comparatorByName('pep440') as Comparator;

function event(part: Partial<OsvEvent>): OsvEvent {
  return { introduced: null, fixed: null, lastAffected: null, limit: null, ...part };
}

function range(type: string, events: Partial<OsvEvent>[]): OsvRange {
  return { type, events: events.map(event) };
}

const affects = (comparator: Comparator, osvRange: OsvRange, version: string): boolean =>
  evaluateRange(comparator, osvRange, version).affected;

describe('evaluateRange with introduced and fixed', () => {
  const open = range('SEMVER', [{ introduced: FROM_THE_BEGINNING }, { fixed: '4.17.21' }]);

  it('affects everything below the fix', () => {
    expect(affects(semver, open, '0.0.1')).toBe(true);
    expect(affects(semver, open, '4.17.20')).toBe(true);
  });

  it('stops at the fix, inclusive of the fixed version itself', () => {
    expect(affects(semver, open, '4.17.21')).toBe(false);
    expect(affects(semver, open, '5.0.0')).toBe(false);
  });

  it('reports the bounds in effect at the version', () => {
    expect(evaluateRange(semver, open, '1.0.0').bounds).toStrictEqual({
      introduced: '0',
      fixed: '4.17.21',
      lastAffected: null,
      limit: null,
    });
  });

  it('does not affect versions below a non-zero introduced', () => {
    const later = range('SEMVER', [{ introduced: '2.0.0' }, { fixed: '2.5.0' }]);
    expect(affects(semver, later, '1.9.9')).toBe(false);
    expect(affects(semver, later, '2.0.0')).toBe(true);
    expect(affects(semver, later, '2.4.9')).toBe(true);
    expect(affects(semver, later, '2.5.0')).toBe(false);
  });
});

describe('evaluateRange with several intervals', () => {
  const twoIntervals = range('SEMVER', [
    { introduced: '1.0.0' },
    { fixed: '1.5.0' },
    { introduced: '2.0.0' },
    { fixed: '2.5.0' },
  ]);

  it('affects each interval and neither gap', () => {
    expect(affects(semver, twoIntervals, '0.9.0')).toBe(false);
    expect(affects(semver, twoIntervals, '1.2.0')).toBe(true);
    expect(affects(semver, twoIntervals, '1.7.0')).toBe(false);
    expect(affects(semver, twoIntervals, '2.2.0')).toBe(true);
    expect(affects(semver, twoIntervals, '3.0.0')).toBe(false);
  });

  it('reports the interval the version is in, not the first one', () => {
    expect(evaluateRange(semver, twoIntervals, '2.2.0').bounds).toStrictEqual({
      introduced: '2.0.0',
      fixed: '2.5.0',
      lastAffected: null,
      limit: null,
    });
  });

  it('reports the nearest bound, not the last one it walks past', () => {
    expect(evaluateRange(semver, twoIntervals, '1.2.0').bounds).toStrictEqual({
      introduced: '1.0.0',
      fixed: '1.5.0',
      lastAffected: null,
      limit: null,
    });
  });

  it('reports the nearest last_affected and limit across two intervals', () => {
    const bounded = range('SEMVER', [
      { introduced: '1.0.0' },
      { lastAffected: '1.4.0' },
      { introduced: '2.0.0' },
      { lastAffected: '2.4.0' },
    ]);
    expect(evaluateRange(semver, bounded, '1.2.0').bounds.lastAffected).toBe('1.4.0');

    const limited = range('SEMVER', [
      { introduced: '1.0.0' },
      { limit: '1.5.0' },
      { introduced: '2.0.0' },
      { limit: '2.5.0' },
    ]);
    expect(evaluateRange(semver, limited, '1.2.0').bounds.limit).toBe('1.5.0');
  });

  it('gives the same answer when the events are written out of order', () => {
    const shuffled = range('SEMVER', [
      { fixed: '2.5.0' },
      { introduced: '1.0.0' },
      { fixed: '1.5.0' },
      { introduced: '2.0.0' },
    ]);
    for (const version of ['0.9.0', '1.2.0', '1.7.0', '2.2.0', '3.0.0']) {
      expect(affects(semver, shuffled, version)).toBe(affects(semver, twoIntervals, version));
    }
  });
});

describe('evaluateRange with last_affected and limit', () => {
  it('includes the last affected version and excludes the next one', () => {
    const bounded = range('ECOSYSTEM', [{ introduced: '1.2.0' }, { lastAffected: '1.4.7' }]);
    expect(affects(semver, bounded, '1.4.7')).toBe(true);
    expect(affects(semver, bounded, '1.4.8')).toBe(false);
    expect(evaluateRange(semver, bounded, '1.3.0').bounds.lastAffected).toBe('1.4.7');
  });

  it('excludes the limit version itself', () => {
    const limited = range('SEMVER', [{ introduced: '1.0.0' }, { limit: '2.0.0' }]);
    expect(affects(semver, limited, '1.9.9')).toBe(true);
    expect(affects(semver, limited, '2.0.0')).toBe(false);
    expect(evaluateRange(semver, limited, '1.0.0').bounds.limit).toBe('2.0.0');
  });
});

describe('evaluateRange edge cases', () => {
  it('affects nothing when the range has no events', () => {
    expect(affects(semver, range('SEMVER', []), '1.0.0')).toBe(false);
  });

  it('affects nothing when the range only closes an interval', () => {
    expect(affects(semver, range('SEMVER', [{ fixed: '2.0.0' }]), '1.0.0')).toBe(false);
  });

  it('leaves an interval open when nothing closes it', () => {
    const forever = range('SEMVER', [{ introduced: '1.0.0' }]);
    expect(affects(semver, forever, '99.0.0')).toBe(true);
    expect(evaluateRange(semver, forever, '99.0.0').bounds.fixed).toBeNull();
  });

  it('returns null bounds when the version is not affected', () => {
    expect(
      evaluateRange(semver, range('SEMVER', [{ introduced: '2.0.0' }]), '1.0.0'),
    ).toStrictEqual({
      affected: false,
      bounds: { introduced: null, fixed: null, lastAffected: null, limit: null },
    });
  });

  it('ignores an event with no field at all', () => {
    expect(affects(semver, range('SEMVER', [{}, { introduced: '1.0.0' }]), '1.0.0')).toBe(true);
  });

  it('uses the ecosystem comparator for ECOSYSTEM ranges', () => {
    const pypi = range('ECOSYSTEM', [{ introduced: '2.0' }, { fixed: '2.31.0' }]);
    expect(affects(pep440, pypi, '2.30.0')).toBe(true);
    expect(affects(pep440, pypi, '2.31.0')).toBe(false);
    expect(affects(pep440, pypi, '2.31.0.dev1')).toBe(true);
  });
});

describe('sortEvents', () => {
  it('puts the zero sentinel first', () => {
    const sorted = sortEvents(semver, [
      event({ fixed: '1.0.0' }),
      event({ introduced: FROM_THE_BEGINNING }),
    ]);
    expect(sorted[0]?.introduced).toBe(FROM_THE_BEGINNING);
  });

  it('keeps two zero sentinels together', () => {
    const sorted = sortEvents(semver, [
      event({ introduced: FROM_THE_BEGINNING }),
      event({ introduced: FROM_THE_BEGINNING }),
    ]);
    expect(sorted).toHaveLength(2);
  });

  it('puts introduced before fixed at the same version', () => {
    const sorted = sortEvents(semver, [event({ fixed: '1.0.0' }), event({ introduced: '1.0.0' })]);
    expect(sorted[0]?.introduced).toBe('1.0.0');
  });

  it('orders last_affected after fixed and limit after both at the same version', () => {
    const sorted = sortEvents(semver, [
      event({ limit: '1.0.0' }),
      event({ lastAffected: '1.0.0' }),
      event({ fixed: '1.0.0' }),
    ]);
    expect(sorted.map((entry) => entry.fixed ?? entry.lastAffected ?? entry.limit)).toStrictEqual([
      '1.0.0',
      '1.0.0',
      '1.0.0',
    ]);
    expect(sorted[0]?.fixed).toBe('1.0.0');
    expect(sorted[1]?.lastAffected).toBe('1.0.0');
    expect(sorted[2]?.limit).toBe('1.0.0');
  });

  it('sorts an event with no version by kind alone, in either argument position', () => {
    expect(sortEvents(semver, [event({}), event({ introduced: '1.0.0' })])[0]?.introduced).toBe(
      '1.0.0',
    );
    expect(sortEvents(semver, [event({ introduced: '1.0.0' }), event({})])[0]?.introduced).toBe(
      '1.0.0',
    );
    expect(sortEvents(semver, [event({}), event({})])).toHaveLength(2);
  });

  it('orders an event with no field at all last among the versionless ones', () => {
    const sorted = sortEvents(semver, [event({}), event({ limit: '1.0.0' })]);
    expect(sorted[0]?.limit).toBe('1.0.0');
    expect(sorted[1]?.limit).toBeNull();
  });

  it('does not compare the zero sentinel with the ecosystem comparator', () => {
    // pep440 refuses "0" only in the sense that it is a valid version there, so
    // use a comparator that would throw on it to prove the sentinel short
    // circuits before any comparison happens.
    const explodes: Comparator = {
      name: 'explodes',
      accepts: () => true,
      compare: () => {
        throw new Error('the sentinel reached the comparator');
      },
    };
    expect(() =>
      sortEvents(explodes, [
        event({ introduced: FROM_THE_BEGINNING }),
        event({ introduced: FROM_THE_BEGINNING }),
      ]),
    ).not.toThrow();
  });
});

describe('rangeVersions', () => {
  it('lists every version an event refers to except the zero sentinel', () => {
    const mixed = range('SEMVER', [
      { introduced: FROM_THE_BEGINNING },
      { fixed: '1.0.0' },
      { introduced: '2.0.0' },
      { lastAffected: '2.5.0' },
      { limit: '3.0.0' },
      {},
    ]);
    expect(rangeVersions(mixed)).toStrictEqual(['1.0.0', '2.0.0', '2.5.0', '3.0.0']);
  });
});
