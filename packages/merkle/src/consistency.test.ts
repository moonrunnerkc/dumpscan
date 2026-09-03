import { describe, expect, it } from 'vitest';

import { consistencyProof, verifyConsistency } from './consistency.js';
import { leafHash } from './hash.js';
import { rootFromLeafHashes } from './tree.js';
import {
  bytesFromHex,
  CT_CONSISTENCY,
  CT_ENTRIES,
  CT_ROOTS,
  hexFromBytes,
} from './vectors.fixture.js';

const leaves = CT_ENTRIES.map(bytesFromHex).map(leafHash);
const rootAt = (size: number): Uint8Array => bytesFromHex(CT_ROOTS[size] as string);

describe('consistencyProof', () => {
  it('matches the Certificate Transparency consistency paths', () => {
    for (const { first, second, path } of CT_CONSISTENCY) {
      expect(consistencyProof(leaves.slice(0, second), first).map(hexFromBytes)).toStrictEqual(
        path,
      );
    }
  });

  it('is empty when the tree has not grown', () => {
    expect(consistencyProof(leaves, 8)).toStrictEqual([]);
  });

  it('refuses a size that is not a prefix of the current tree', () => {
    expect(() => consistencyProof(leaves, 0)).toThrow(/must be between 1 and the current size 8/);
    expect(() => consistencyProof(leaves, 9)).toThrow(/must be between 1 and the current size 8/);
    expect(() => consistencyProof(leaves, 2.5)).toThrow(/must be between 1/);
  });
});

describe('verifyConsistency', () => {
  it('accepts every generated proof for every pair of sizes up to 24', () => {
    const wide = Array.from({ length: 24 }, (_, i) => leafHash(Uint8Array.from([i, i * 3])));
    for (let second = 1; second <= wide.length; second += 1) {
      const later = wide.slice(0, second);
      const secondRoot = rootFromLeafHashes(later);
      for (let first = 1; first <= second; first += 1) {
        const firstRoot = rootFromLeafHashes(wide.slice(0, first));
        const proof = consistencyProof(later, first);
        expect(verifyConsistency(firstRoot, secondRoot, first, second, proof)).toBe(true);
      }
    }
  });

  it('rejects a proof between the wrong pair of sizes', () => {
    const proof = consistencyProof(leaves.slice(0, 7), 3);
    expect(verifyConsistency(rootAt(3), rootAt(8), 3, 8, proof)).toBe(false);
    expect(verifyConsistency(rootAt(4), rootAt(7), 4, 7, proof)).toBe(false);
  });

  it('rejects a tampered path element', () => {
    const proof = consistencyProof(leaves.slice(0, 7), 3);
    const tampered = [...proof];
    const end = proof.length - 1;
    tampered[end] = Uint8Array.from(proof[end] as Uint8Array, (byte, i) =>
      i === 31 ? byte ^ 1 : byte,
    );
    expect(verifyConsistency(rootAt(3), rootAt(7), 3, 7, tampered)).toBe(false);
  });

  it('rejects a claimed earlier root that is not a prefix', () => {
    const proof = consistencyProof(leaves.slice(0, 7), 3);
    expect(verifyConsistency(rootAt(2), rootAt(7), 3, 7, proof)).toBe(false);
  });

  it('requires an empty path when the sizes are equal', () => {
    expect(verifyConsistency(rootAt(4), rootAt(4), 4, 4, [])).toBe(true);
    expect(verifyConsistency(rootAt(4), rootAt(5), 4, 4, [])).toBe(false);
    expect(verifyConsistency(rootAt(4), rootAt(4), 4, 4, [leaves[0] as Uint8Array])).toBe(false);
  });

  it('rejects nonsensical size arguments', () => {
    expect(verifyConsistency(rootAt(3), rootAt(7), 0, 7, [])).toBe(false);
    expect(verifyConsistency(rootAt(7), rootAt(3), 7, 3, [])).toBe(false);
    expect(verifyConsistency(rootAt(3), rootAt(7), 3.5, 7, [])).toBe(false);
    expect(verifyConsistency(rootAt(3), rootAt(7), 3, 7.5, [])).toBe(false);
  });

  it('rejects an empty path when the tree did grow', () => {
    expect(verifyConsistency(rootAt(3), rootAt(7), 3, 7, [])).toBe(false);
  });

  it('rejects a path longer than the tree can justify', () => {
    const proof = consistencyProof(leaves.slice(0, 7), 3);
    const padded = [...proof, leaves[0] as Uint8Array, leaves[1] as Uint8Array];
    expect(verifyConsistency(rootAt(3), rootAt(7), 3, 7, padded)).toBe(false);
  });
});
