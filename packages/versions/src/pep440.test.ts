import { describe, expect, it } from 'vitest';

import { ABOVE_ALL, BELOW_ALL } from './order.js';
import { comparePep440, comparisonKey, parsePep440 } from './pep440.js';
import type { Pep440Version } from './pep440.js';

const sign = (value: number): number => (value === 0 ? 0 : value < 0 ? -1 : 1);

describe('parsePep440', () => {
  it('splits every segment', () => {
    expect(parsePep440('2!1.0.4rc3.post7.dev9+ubuntu.1')).toStrictEqual({
      epoch: 2,
      release: [1, 0, 4],
      pre: ['rc', 3],
      post: 7,
      dev: 9,
      local: ['ubuntu', 1],
    });
  });

  it('defaults an absent epoch to zero and absent segments to null', () => {
    expect(parsePep440('1.0')).toStrictEqual({
      epoch: 0,
      release: [1, 0],
      pre: null,
      post: null,
      dev: null,
      local: null,
    });
  });

  it('normalizes the pre release spellings', () => {
    for (const [input, letter] of [
      ['1.0alpha1', 'a'],
      ['1.0a1', 'a'],
      ['1.0beta1', 'b'],
      ['1.0b1', 'b'],
      ['1.0c1', 'rc'],
      ['1.0pre1', 'rc'],
      ['1.0preview1', 'rc'],
      ['1.0rc1', 'rc'],
    ] as const) {
      expect(parsePep440(input)?.pre).toStrictEqual([letter, 1]);
    }
  });

  it('defaults a bare pre, post, or dev marker to zero', () => {
    expect(parsePep440('1.0a')?.pre).toStrictEqual(['a', 0]);
    expect(parsePep440('1.0.post')?.post).toBe(0);
    expect(parsePep440('1.0.dev')?.dev).toBe(0);
  });

  it('reads the implicit post release spelling', () => {
    expect(parsePep440('1.0-1')?.post).toBe(1);
    expect(parsePep440('1.0rev2')?.post).toBe(2);
    expect(parsePep440('1.0-r-3')?.post).toBe(3);
  });

  it('accepts a leading v, surrounding whitespace, and any case', () => {
    expect(parsePep440('  V1.0A1  ')).toStrictEqual(parsePep440('1.0a1'));
  });

  it('accepts any of the three separators between segments', () => {
    expect(parsePep440('1.0_dev_1')).toStrictEqual(parsePep440('1.0.dev1'));
    expect(parsePep440('1.0-beta-1')).toStrictEqual(parsePep440('1.0b1'));
  });

  it('lowercases the local version and splits it into numeric and string segments', () => {
    expect(parsePep440('1.0+ABC.5-x_9')?.local).toStrictEqual(['abc', 5, 'x', 9]);
  });

  it('treats a local segment as numeric only when it is digits end to end', () => {
    expect(parsePep440('1.0+11')?.local).toStrictEqual([11]);
    expect(parsePep440('1.0+1a')?.local).toStrictEqual(['1a']);
    expect(parsePep440('1.0+a1')?.local).toStrictEqual(['a1']);
    expect(parsePep440('1.0+007')?.local).toStrictEqual([7]);
  });

  it('reads multi digit epochs, post numbers, and release segments', () => {
    expect(parsePep440('12!1.0')?.epoch).toBe(12);
    expect(parsePep440('1.0-12')?.post).toBe(12);
    expect(parsePep440('1.0.post34')?.post).toBe(34);
    expect(parsePep440('1.0a56')?.pre).toStrictEqual(['a', 56]);
    expect(parsePep440('1.0.dev78')?.dev).toBe(78);
    expect(parsePep440('123.456')?.release).toStrictEqual([123, 456]);
  });

  it('rejects strings that are not PEP 440 versions', () => {
    for (const value of ['', 'french toast', '1.0.0-', '1.0.0+', '1.-1', '*', '1.0+_']) {
      expect(parsePep440(value)).toBeNull();
    }
  });
});

describe('comparisonKey', () => {
  it('drops trailing zeros from the release segment', () => {
    const key = comparisonKey(parsePep440('1.0.0.0') as Pep440Version);
    expect(key[1]).toStrictEqual([1]);
  });

  it('keeps interior zeros', () => {
    const key = comparisonKey(parsePep440('1.0.1') as Pep440Version);
    expect(key[1]).toStrictEqual([1, 0, 1]);
  });

  it('drops the whole release when it is all zeros', () => {
    expect(comparisonKey(parsePep440('0.0') as Pep440Version)[1]).toStrictEqual([]);
  });

  it('sorts a bare dev release below every pre release', () => {
    expect(comparisonKey(parsePep440('1.0.dev1') as Pep440Version)[2]).toBe(BELOW_ALL);
  });

  it('sorts an absent pre release above every pre release', () => {
    expect(comparisonKey(parsePep440('1.0') as Pep440Version)[2]).toBe(ABOVE_ALL);
  });

  it('keeps the pre release tuple when there is one', () => {
    expect(comparisonKey(parsePep440('1.0rc2') as Pep440Version)[2]).toStrictEqual(['rc', 2]);
  });

  it('does not treat a post dev release as a bare dev release', () => {
    expect(comparisonKey(parsePep440('1.0.post1.dev2') as Pep440Version)[2]).toBe(ABOVE_ALL);
  });

  it('sorts an absent post below any post and an absent dev above any dev', () => {
    const key = comparisonKey(parsePep440('1.0') as Pep440Version);
    expect(key[3]).toBe(BELOW_ALL);
    expect(key[4]).toBe(ABOVE_ALL);
  });

  it('sorts an absent local below any local, and string segments below numeric ones', () => {
    expect(comparisonKey(parsePep440('1.0') as Pep440Version)[5]).toBe(BELOW_ALL);
    expect(comparisonKey(parsePep440('1.0+abc.5') as Pep440Version)[5]).toStrictEqual([
      [BELOW_ALL, 'abc'],
      [5, ''],
    ]);
  });
});

describe('comparePep440', () => {
  it('orders by epoch first, whatever the release says', () => {
    expect(sign(comparePep440('1!0.1', '99.0'))).toBe(1);
  });

  it('pads the shorter release with zeros', () => {
    expect(comparePep440('1.0', '1.0.0')).toBe(0);
    expect(sign(comparePep440('1.0', '1.0.1'))).toBe(-1);
  });

  it('orders dev below pre below release below post', () => {
    expect(sign(comparePep440('1.0.dev1', '1.0a1'))).toBe(-1);
    expect(sign(comparePep440('1.0a1', '1.0'))).toBe(-1);
    expect(sign(comparePep440('1.0', '1.0.post1'))).toBe(-1);
  });

  it('orders a dev release below the pre release it belongs to', () => {
    expect(sign(comparePep440('1.0a1.dev1', '1.0a1'))).toBe(-1);
    expect(sign(comparePep440('1.0.post1.dev1', '1.0.post1'))).toBe(-1);
  });

  it('orders pre release letters a, b, rc', () => {
    expect(sign(comparePep440('1.0a9', '1.0b1'))).toBe(-1);
    expect(sign(comparePep440('1.0b9', '1.0rc1'))).toBe(-1);
  });

  it('orders pre release numbers numerically', () => {
    expect(sign(comparePep440('1.0rc2', '1.0rc10'))).toBe(-1);
  });

  it('puts a local version above the same version without one', () => {
    expect(sign(comparePep440('1.0', '1.0+local'))).toBe(-1);
  });

  it('puts a string local segment below a numeric one', () => {
    expect(sign(comparePep440('1.0+abc.7', '1.0+5'))).toBe(-1);
  });

  it('names the offending version and says what to do about it', () => {
    expect(() => comparePep440('french toast', '1.0')).toThrow(
      /"french toast" is not a PEP 440 version/,
    );
    expect(() => comparePep440('1.0', '*')).toThrow(/"\*" is not a PEP 440 version/);
  });
});
