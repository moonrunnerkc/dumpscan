import { describe, expect, it } from 'vitest';

import { ABOVE_ALL, BELOW_ALL, compareDigitStrings, compareKeys } from './order.js';
import type { KeyPart } from './order.js';

const sign = (value: number): number => (value === 0 ? 0 : value < 0 ? -1 : 1);

describe('compareDigitStrings', () => {
  it('orders by magnitude, not lexically', () => {
    expect(sign(compareDigitStrings('9', '10'))).toBe(-1);
    expect(sign(compareDigitStrings('10', '9'))).toBe(1);
    expect(compareDigitStrings('10', '10')).toBe(0);
  });

  it('ignores leading zeros', () => {
    expect(compareDigitStrings('007', '7')).toBe(0);
    expect(sign(compareDigitStrings('0010', '9'))).toBe(1);
  });

  it('treats an all zero string as zero', () => {
    expect(compareDigitStrings('000', '0')).toBe(0);
    expect(sign(compareDigitStrings('000', '1'))).toBe(-1);
  });

  it('stays exact past the safe integer range, where doubles collapse', () => {
    const a = '9007199254740993';
    const b = '9007199254740992';
    expect(Number(a)).toBe(Number(b));
    expect(sign(compareDigitStrings(a, b))).toBe(1);
  });

  it('compares equal length strings by digit', () => {
    expect(sign(compareDigitStrings('123', '124'))).toBe(-1);
  });
});

describe('compareKeys', () => {
  it('compares element by element', () => {
    expect(sign(compareKeys([1, 2], [1, 3]))).toBe(-1);
    expect(compareKeys([1, 2], [1, 2])).toBe(0);
  });

  it('puts a prefix before the longer key', () => {
    expect(sign(compareKeys([1], [1, 0]))).toBe(-1);
    expect(sign(compareKeys([1, 0], [1]))).toBe(1);
  });

  it('sorts BELOW_ALL under every other kind of part', () => {
    const others: KeyPart[] = [0, -1, '', 'a', [], ABOVE_ALL];
    for (const other of others) {
      expect(sign(compareKeys([BELOW_ALL], [other]))).toBe(-1);
      expect(sign(compareKeys([other], [BELOW_ALL]))).toBe(1);
    }
  });

  it('sorts ABOVE_ALL over every other kind of part', () => {
    const others: KeyPart[] = [0, 9e9, 'z', []];
    for (const other of others) {
      expect(sign(compareKeys([ABOVE_ALL], [other]))).toBe(1);
      expect(sign(compareKeys([other], [ABOVE_ALL]))).toBe(-1);
    }
  });

  it('treats two sentinels of the same kind as equal', () => {
    expect(compareKeys([BELOW_ALL], [BELOW_ALL])).toBe(0);
    expect(compareKeys([ABOVE_ALL], [ABOVE_ALL])).toBe(0);
  });

  it('ranks numbers below strings below lists', () => {
    expect(sign(compareKeys([9], ['0']))).toBe(-1);
    expect(sign(compareKeys(['zzz'], [[]]))).toBe(-1);
  });

  it('recurses into nested lists', () => {
    expect(sign(compareKeys([[1, 'a']], [[1, 'b']]))).toBe(-1);
    expect(compareKeys([[1, 'a']], [[1, 'a']])).toBe(0);
    expect(sign(compareKeys([[1]], [[1, 0]]))).toBe(-1);
  });

  it('compares strings by code unit', () => {
    expect(sign(compareKeys(['B'], ['a']))).toBe(-1);
    expect(compareKeys(['a'], ['a'])).toBe(0);
  });

  it('handles two empty keys', () => {
    expect(compareKeys([], [])).toBe(0);
  });
});
