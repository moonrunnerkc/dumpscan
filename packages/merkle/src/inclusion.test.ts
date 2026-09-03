import { describe, expect, it } from 'vitest';

import { leafHash } from './hash.js';
import { inclusionProof, verifyInclusion } from './inclusion.js';
import { rootFromLeafHashes } from './tree.js';
import {
  bytesFromHex,
  CT_ENTRIES,
  CT_INCLUSION,
  CT_ROOTS,
  hexFromBytes,
} from './vectors.fixture.js';

const leaves = CT_ENTRIES.map(bytesFromHex).map(leafHash);

describe('inclusionProof', () => {
  it('matches the Certificate Transparency audit paths', () => {
    for (const { index, path } of CT_INCLUSION) {
      expect(inclusionProof(leaves, index).map(hexFromBytes)).toStrictEqual(path);
    }
  });

  it('produces a path of ceil(log2(size)) hashes for a full tree', () => {
    expect(inclusionProof(leaves, 3)).toHaveLength(3);
  });

  it('omits the sibling for a promoted node', () => {
    // In a tree of five, leaf four has no sibling at levels zero or one.
    expect(inclusionProof(leaves.slice(0, 5), 4)).toHaveLength(1);
  });

  it('returns an empty path for a single leaf tree', () => {
    expect(inclusionProof(leaves.slice(0, 1), 0)).toStrictEqual([]);
  });

  it('refuses an index outside the tree', () => {
    expect(() => inclusionProof(leaves, 8)).toThrow(/index 8 is outside a tree of 8 leaves/);
    expect(() => inclusionProof(leaves, -1)).toThrow(/outside a tree/);
    expect(() => inclusionProof(leaves, 1.5)).toThrow(/outside a tree/);
    expect(() => inclusionProof([], 0)).toThrow(/tree of 0 leaves/);
  });
});

describe('verifyInclusion', () => {
  it('accepts every generated proof for every tree size up to 33', () => {
    const wide = Array.from({ length: 33 }, (_, i) => leafHash(Uint8Array.from([i, i >> 4])));
    for (let size = 1; size <= wide.length; size += 1) {
      const subset = wide.slice(0, size);
      const root = rootFromLeafHashes(subset);
      for (let index = 0; index < size; index += 1) {
        const proof = inclusionProof(subset, index);
        expect(verifyInclusion(root, subset[index] as Uint8Array, index, size, proof)).toBe(true);
      }
    }
  });

  it('rejects a proof replayed at the wrong index', () => {
    const root = bytesFromHex(CT_ROOTS[8] as string);
    const proof = inclusionProof(leaves, 3);
    expect(verifyInclusion(root, leaves[3] as Uint8Array, 4, 8, proof)).toBe(false);
  });

  it('rejects a proof for a different leaf', () => {
    const root = bytesFromHex(CT_ROOTS[8] as string);
    const proof = inclusionProof(leaves, 3);
    expect(verifyInclusion(root, leaves[2] as Uint8Array, 3, 8, proof)).toBe(false);
  });

  it('rejects a tampered path element', () => {
    const root = bytesFromHex(CT_ROOTS[8] as string);
    const proof = inclusionProof(leaves, 3);
    const tampered = [...proof];
    tampered[0] = Uint8Array.from(proof[0] as Uint8Array, (byte, i) =>
      i === 0 ? byte ^ 0xff : byte,
    );
    expect(verifyInclusion(root, leaves[3] as Uint8Array, 3, 8, tampered)).toBe(false);
  });

  it('rejects a path that is too long or too short', () => {
    const root = bytesFromHex(CT_ROOTS[8] as string);
    const proof = inclusionProof(leaves, 3);
    expect(verifyInclusion(root, leaves[3] as Uint8Array, 3, 8, proof.slice(1))).toBe(false);
    expect(
      verifyInclusion(root, leaves[3] as Uint8Array, 3, 8, [...proof, leaves[0] as Uint8Array]),
    ).toBe(false);
  });

  it('rejects nonsensical index and size arguments', () => {
    const root = bytesFromHex(CT_ROOTS[8] as string);
    const leaf = leaves[0] as Uint8Array;
    expect(verifyInclusion(root, leaf, 0, 0, [])).toBe(false);
    expect(verifyInclusion(root, leaf, -1, 8, [])).toBe(false);
    expect(verifyInclusion(root, leaf, 8, 8, [])).toBe(false);
    expect(verifyInclusion(root, leaf, 0.5, 8, [])).toBe(false);
    expect(verifyInclusion(root, leaf, 0, 8.5, [])).toBe(false);
  });

  it('accepts the trivial single leaf tree and rejects a padded proof for it', () => {
    const single = [leaves[0] as Uint8Array];
    const root = rootFromLeafHashes(single);
    expect(verifyInclusion(root, single[0] as Uint8Array, 0, 1, [])).toBe(true);
    expect(verifyInclusion(root, single[0] as Uint8Array, 0, 1, [leaves[1] as Uint8Array])).toBe(
      false,
    );
  });
});
