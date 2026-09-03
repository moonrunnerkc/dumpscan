import { describe, expect, it } from 'vitest';

import { compareBytes, compareCodeUnits } from './compare.js';

describe('compareCodeUnits', () => {
  it('orders by UTF-16 code unit', () => {
    expect(compareCodeUnits('a', 'b')).toBeLessThan(0);
    expect(compareCodeUnits('b', 'a')).toBeGreaterThan(0);
    expect(compareCodeUnits('a', 'a')).toBe(0);
  });

  it('puts a prefix before the longer string', () => {
    expect(compareCodeUnits('ab', 'abc')).toBeLessThan(0);
  });

  it('ignores case folding and collation rules', () => {
    // Under an ICU collation 'a' sorts before 'B'. By code unit it does not.
    expect(compareCodeUnits('B', 'a')).toBeLessThan(0);
  });

  it('places a surrogate pair before U+FB33 even though its code point is higher', () => {
    expect(compareCodeUnits('\ud83d\ude02', '\ufb33')).toBeLessThan(0);
  });
});

describe('compareBytes', () => {
  it('orders by first differing byte', () => {
    expect(compareBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 3]))).toBeLessThan(0);
    expect(compareBytes(Uint8Array.from([1, 3]), Uint8Array.from([1, 2]))).toBeGreaterThan(0);
  });

  it('treats high bytes as unsigned', () => {
    expect(compareBytes(Uint8Array.from([0x7f]), Uint8Array.from([0x80]))).toBeLessThan(0);
  });

  it('puts a prefix before the longer sequence', () => {
    expect(compareBytes(Uint8Array.from([1]), Uint8Array.from([1, 0]))).toBeLessThan(0);
  });

  it('reports equality for identical content', () => {
    expect(compareBytes(Uint8Array.from([9, 9]), Uint8Array.from([9, 9]))).toBe(0);
  });
});
