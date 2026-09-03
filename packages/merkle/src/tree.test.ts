import { describe, expect, it } from 'vitest';

import { leafHash, nodeHash } from './hash.js';
import { buildTree, merkleRoot, rootFromLeafHashes, rootOfRange } from './tree.js';
import { bytesFromHex, CT_ENTRIES, CT_ROOTS, hexFromBytes } from './vectors.fixture.js';

const entries = CT_ENTRIES.map(bytesFromHex);

/**
 * The recursive definition from RFC 6962 section 2.1, written straight from the
 * text. The implementation under test builds levels bottom up instead, so this
 * is a genuine second opinion on the shape of the tree.
 */
function recursiveRoot(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return bytesFromHex(CT_ROOTS[0] as string);
  if (leaves.length === 1) return leafHash(leaves[0] as Uint8Array);
  let split = 1;
  while (split * 2 < leaves.length) split *= 2;
  return nodeHash(recursiveRoot(leaves.slice(0, split)), recursiveRoot(leaves.slice(split)));
}

describe('merkleRoot', () => {
  it('matches the Certificate Transparency tree heads for every prefix', () => {
    for (let size = 0; size <= entries.length; size += 1) {
      expect(hexFromBytes(merkleRoot(entries.slice(0, size)))).toBe(CT_ROOTS[size]);
    }
  });

  it('agrees with the recursive RFC 6962 definition up to 64 leaves', () => {
    const leaves: Uint8Array[] = [];
    for (let i = 0; i < 64; i += 1) {
      leaves.push(Uint8Array.from([i & 0xff, (i * 7) & 0xff]));
      expect(hexFromBytes(merkleRoot(leaves))).toBe(hexFromBytes(recursiveRoot(leaves)));
    }
  });

  it('hashes the empty tree to SHA-256 of the empty string', () => {
    expect(hexFromBytes(merkleRoot([]))).toBe(CT_ROOTS[0]);
  });

  it('returns the leaf hash unchanged for a single entry', () => {
    expect(hexFromBytes(merkleRoot([entries[0] as Uint8Array]))).toBe(
      hexFromBytes(leafHash(entries[0] as Uint8Array)),
    );
  });

  it('depends on entry order', () => {
    const forward = merkleRoot(entries.slice(0, 4));
    const reversed = merkleRoot(entries.slice(0, 4).reverse());
    expect(hexFromBytes(forward)).not.toBe(hexFromBytes(reversed));
  });
});

describe('buildTree', () => {
  it('reports the leaf count and exposes level zero as the leaf hashes', () => {
    const leaves = entries.map(leafHash);
    const tree = buildTree(leaves);
    expect(tree.size).toBe(8);
    expect(tree.levels[0]).toStrictEqual(leaves);
    expect(hexFromBytes(tree.root)).toBe(CT_ROOTS[8]);
  });

  it('has one more level than the tree height', () => {
    expect(buildTree(entries.slice(0, 5).map(leafHash)).levels).toHaveLength(4);
    expect(buildTree(entries.slice(0, 4).map(leafHash)).levels).toHaveLength(3);
  });

  it('promotes an unpaired node instead of duplicating it', () => {
    const leaves = entries.slice(0, 3).map(leafHash);
    const tree = buildTree(leaves);
    expect(hexFromBytes((tree.levels[1] as Uint8Array[])[1] as Uint8Array)).toBe(
      hexFromBytes(leaves[2] as Uint8Array),
    );
  });

  it('describes the empty tree as one empty level', () => {
    const tree = buildTree([]);
    expect(tree.size).toBe(0);
    expect(tree.levels).toStrictEqual([[]]);
  });
});

describe('rootFromLeafHashes and rootOfRange', () => {
  it('take leaf hashes rather than entry bytes', () => {
    expect(hexFromBytes(rootFromLeafHashes(entries.map(leafHash)))).toBe(CT_ROOTS[8]);
  });

  it('root a contiguous slice', () => {
    const leaves = entries.map(leafHash);
    expect(hexFromBytes(rootOfRange(leaves, 0, 4))).toBe(CT_ROOTS[4]);
    expect(hexFromBytes(rootOfRange(leaves, 4, 8))).toBe(
      hexFromBytes(rootFromLeafHashes(leaves.slice(4, 8))),
    );
  });
});
