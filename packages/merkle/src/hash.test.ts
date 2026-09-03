import { describe, expect, it } from 'vitest';

import { EMPTY_TREE_ROOT, hashesEqual, leafHash, nodeHash, sha256 } from './hash.js';

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('sha256', () => {
  it('matches the published vector for the empty string', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('leafHash', () => {
  it('prefixes the entry with 0x00 per RFC 6962', () => {
    expect(hex(leafHash(new Uint8Array(0)))).toBe(
      '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
    );
    expect(hex(leafHash(new Uint8Array(0)))).toBe(hex(sha256(Uint8Array.from([0x00]))));
  });

  it('separates the empty leaf from the empty tree', () => {
    expect(hex(leafHash(new Uint8Array(0)))).not.toBe(hex(EMPTY_TREE_ROOT));
  });
});

describe('nodeHash', () => {
  it('prefixes the concatenation with 0x01 per RFC 6962', () => {
    const left = leafHash(new Uint8Array(0));
    const right = leafHash(Uint8Array.from([0x00]));
    const expected = sha256(Uint8Array.from([0x01, ...left, ...right]));
    expect(hex(nodeHash(left, right))).toBe(hex(expected));
  });

  it('is order sensitive, so a swapped pair cannot forge a root', () => {
    const left = leafHash(Uint8Array.from([1]));
    const right = leafHash(Uint8Array.from([2]));
    expect(hex(nodeHash(left, right))).not.toBe(hex(nodeHash(right, left)));
  });

  it('cannot be confused with a leaf over the same bytes', () => {
    const left = leafHash(Uint8Array.from([1]));
    const right = leafHash(Uint8Array.from([2]));
    const concatenated = Uint8Array.from([...left, ...right]);
    expect(hex(nodeHash(left, right))).not.toBe(hex(leafHash(concatenated)));
  });
});

describe('hashesEqual', () => {
  it('compares content', () => {
    expect(hashesEqual(Uint8Array.from([1, 2]), Uint8Array.from([1, 2]))).toBe(true);
    expect(hashesEqual(Uint8Array.from([1, 2]), Uint8Array.from([1, 3]))).toBe(false);
  });

  it('rejects a length mismatch outright', () => {
    expect(hashesEqual(Uint8Array.from([1]), Uint8Array.from([1, 2]))).toBe(false);
  });

  it('accepts two empty hashes', () => {
    expect(hashesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});
