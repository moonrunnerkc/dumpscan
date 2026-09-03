import { describe, expect, it } from 'vitest';

import {
  digest,
  digestOfJson,
  formatDigest,
  fromHex,
  isDigest,
  parseDigest,
  sha256,
  toHex,
} from './digest.js';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

const encoder = new TextEncoder();

describe('sha256', () => {
  it('matches the published vectors for the empty string and abc', () => {
    expect(toHex(sha256(new Uint8Array(0)))).toBe(EMPTY_SHA256);
    expect(toHex(sha256(encoder.encode('abc')))).toBe(ABC_SHA256);
  });
});

describe('hex encoding', () => {
  it('round trips every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) all[i] = i;
    expect(fromHex(toHex(all))).toStrictEqual(all);
  });

  it('pads single digit bytes', () => {
    expect(toHex(Uint8Array.from([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });

  it('rejects odd length input', () => {
    expect(() => fromHex('abc')).toThrow(/odd length 3/);
  });

  it('rejects uppercase and non hex characters', () => {
    expect(() => fromHex('AB')).toThrow(/not lowercase hex at offset 0/);
    expect(() => fromHex('0z')).toThrow(/not lowercase hex at offset 0/);
  });
});

describe('digest formatting', () => {
  it('renders the sha256 prefix exactly once', () => {
    expect(digest(encoder.encode('abc'))).toBe(`sha256:${ABC_SHA256}`);
  });

  it('rejects a hash that is not 32 bytes', () => {
    expect(() => formatDigest(new Uint8Array(31))).toThrow(/received 31 bytes/);
  });

  it('hashes the canonical form of a JSON value, not its source text', () => {
    const a = digestOfJson({ b: 1, a: 2 });
    const b = digestOfJson({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe(digest(encoder.encode('{"a":2,"b":1}')));
  });

  it('recognizes well formed digests only', () => {
    expect(isDigest(`sha256:${ABC_SHA256}`)).toBe(true);
    expect(isDigest(`sha256:${ABC_SHA256.toUpperCase()}`)).toBe(false);
    expect(isDigest(`sha512:${ABC_SHA256}`)).toBe(false);
    expect(isDigest(ABC_SHA256)).toBe(false);
    expect(isDigest('sha256:abc')).toBe(false);
  });

  it('parses a digest back to its raw hash', () => {
    expect(parseDigest(`sha256:${ABC_SHA256}`)).toStrictEqual(sha256(encoder.encode('abc')));
  });

  it('refuses to parse anything that is not a digest', () => {
    expect(() => parseDigest('sha256:zz')).toThrow(/is not a dumpscan digest/);
  });
});
