import { describe, expect, it } from 'vitest';

import { compareMavenVersion, parseMavenVersion } from './maven-version.js';

const sign = (value: number): number => (value === 0 ? 0 : value < 0 ? -1 : 1);

describe('parseMavenVersion', () => {
  it('splits a dashed qualifier into a nested list', () => {
    expect(parseMavenVersion('1.0-alpha-1')).toStrictEqual({
      kind: 'list',
      items: [
        { kind: 'int', value: '1' },
        {
          kind: 'list',
          items: [
            { kind: 'string', value: 'alpha' },
            { kind: 'list', items: [{ kind: 'int', value: '1' }] },
          ],
        },
      ],
    });
  });

  it('reads a leading separator as a zero', () => {
    expect(parseMavenVersion('.1')).toStrictEqual({
      kind: 'list',
      items: [
        { kind: 'int', value: '0' },
        { kind: 'int', value: '1' },
      ],
    });
    expect(parseMavenVersion('-1')).toStrictEqual({
      kind: 'list',
      items: [{ kind: 'list', items: [{ kind: 'int', value: '1' }] }],
    });
  });

  it('splits a number from the letters that follow it', () => {
    expect(parseMavenVersion('11b')).toStrictEqual({
      kind: 'list',
      items: [
        { kind: 'int', value: '11' },
        { kind: 'list', items: [{ kind: 'string', value: 'b' }] },
      ],
    });
  });

  it('normalizes every nested list, not only the outer one', () => {
    expect(compareMavenVersion('1-1.0', '1-1')).toBe(0);
    expect(compareMavenVersion('1-1.0.0.0', '1-1')).toBe(0);
  });
});

describe('compareMavenVersion equality', () => {
  it('drops trailing zeros, so 1, 1.0, and 1.0.0 are one version', () => {
    expect(compareMavenVersion('1', '1.0')).toBe(0);
    expect(compareMavenVersion('1', '1.0.0')).toBe(0);
    expect(compareMavenVersion('1.0', '1.0.0.0')).toBe(0);
  });

  it('treats ga, final, and release as the release itself', () => {
    for (const alias of ['ga', 'final', 'release']) {
      expect(compareMavenVersion('1', `1-${alias}`)).toBe(0);
    }
  });

  it('treats cr as rc', () => {
    expect(compareMavenVersion('1-cr1', '1-rc1')).toBe(0);
  });

  it('expands a single letter qualifier that is followed by a digit', () => {
    expect(compareMavenVersion('1.0.0-a1', '1.0.0-alpha1')).toBe(0);
    expect(compareMavenVersion('1.0.0-b1', '1.0.0-beta1')).toBe(0);
    expect(compareMavenVersion('1.0.0-m1', '1.0.0-milestone1')).toBe(0);
  });

  it('does not expand a single letter qualifier that stands alone', () => {
    // 11a is an unknown qualifier, not an alpha, because nothing follows it.
    expect(compareMavenVersion('11-a', '11-alpha')).not.toBe(0);
  });

  it('is case insensitive', () => {
    expect(compareMavenVersion('1-SNAPSHOT', '1-snapshot')).toBe(0);
    expect(compareMavenVersion('3.0.0-M1', '3.0.0-m1')).toBe(0);
  });

  it('strips leading zeros from numeric items', () => {
    expect(compareMavenVersion('01.02', '1.2')).toBe(0);
  });
});

describe('compareMavenVersion ordering', () => {
  it('orders the known qualifiers the way Maven documents', () => {
    const ascending = ['1-alpha1', '1-beta1', '1-milestone1', '1-rc1', '1-snapshot', '1', '1-sp'];
    for (let i = 0; i < ascending.length - 1; i += 1) {
      expect(sign(compareMavenVersion(ascending[i] as string, ascending[i + 1] as string))).toBe(
        -1,
      );
    }
  });

  it('puts an unknown qualifier after every known one and after the release', () => {
    expect(sign(compareMavenVersion('1-sp', '1-zzz'))).toBe(-1);
    expect(sign(compareMavenVersion('1', '1-abc'))).toBe(-1);
    // A qualifier that sorts below the release index as a bare string still has
    // to land after the release, which is what the unknown prefix is for.
    expect(sign(compareMavenVersion('1', '1-+foo'))).toBe(-1);
    expect(sign(compareMavenVersion('1-sp', '1-+foo'))).toBe(-1);
  });

  it('orders unknown qualifiers among themselves lexically', () => {
    expect(sign(compareMavenVersion('1-abc', '1-def'))).toBe(-1);
  });

  it('orders numeric items numerically, not lexically', () => {
    expect(sign(compareMavenVersion('1-m2', '1-m11'))).toBe(-1);
    expect(sign(compareMavenVersion('2.9', '2.10'))).toBe(-1);
  });

  it('puts a numeric item above a qualifier at the same position', () => {
    expect(sign(compareMavenVersion('2.0.a', '2.0.2'))).toBe(-1);
  });

  it('orders a release above every prerelease of the same number', () => {
    expect(sign(compareMavenVersion('3.0.0-M1', '3.0.0'))).toBe(-1);
    expect(sign(compareMavenVersion('3.0.0-M1', '3.0.0-M2'))).toBe(-1);
  });

  it('orders a dashed subversion below the number that follows it', () => {
    expect(sign(compareMavenVersion('1-1', '1-2'))).toBe(-1);
    expect(sign(compareMavenVersion('1-1-snapshot', '1-1'))).toBe(-1);
  });

  it('accepts every string, because ComparableVersion has no failure mode', () => {
    expect(sign(compareMavenVersion('not a version', 'also not a version'))).toBe(1);
    expect(compareMavenVersion('', '')).toBe(0);
    expect(sign(compareMavenVersion('', '1'))).toBe(-1);
  });
});

describe('compareMavenVersion is not a total order', () => {
  it('orders a qualifier above a nested list, which is where transitivity breaks', () => {
    // 11.a2 parses to [11, alpha, [2]] and 11b to [11, [b]]. Maven compares a
    // qualifier above a list, so 11.a2 is above 11b even though 11.a2 is below
    // 11 and 11 is below 11b. The corpus is restricted to the region where the
    // algorithm does order consistently; this test pins the behaviour rather
    // than pretending it does not exist.
    expect(sign(compareMavenVersion('11.a2', '11b'))).toBe(1);
    expect(sign(compareMavenVersion('11.a2', '11'))).toBe(-1);
    expect(sign(compareMavenVersion('11', '11b'))).toBe(-1);
  });
});
