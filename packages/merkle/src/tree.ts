import { EMPTY_TREE_ROOT, leafHash, nodeHash } from './hash.js';

/**
 * A built RFC 6962 tree, level 0 holding the leaf hashes and the last level
 * holding the single root. Nodes without a sibling are promoted unchanged,
 * which is what makes this bottom-up construction equal to the recursive
 * definition in RFC 6962 section 2.1.
 */
export interface MerkleTree {
  readonly levels: readonly (readonly Uint8Array[])[];
  readonly size: number;
  readonly root: Uint8Array;
}

/**
 * Builds a tree over already computed leaf hashes.
 *
 * @param leafHashes - Leaf hashes in the order they should appear in the tree.
 * @returns The built tree.
 */
export function buildTree(leafHashes: readonly Uint8Array[]): MerkleTree {
  if (leafHashes.length === 0) {
    return { levels: [[]], size: 0, root: EMPTY_TREE_ROOT };
  }

  const levels: Uint8Array[][] = [[...leafHashes]];
  let current = levels[0] as Uint8Array[];
  while (current.length > 1) {
    const next: Uint8Array[] = [];
    let i = 0;
    for (; i + 1 < current.length; i += 2) {
      next.push(nodeHash(current[i] as Uint8Array, current[i + 1] as Uint8Array));
    }
    if (i < current.length) next.push(current[i] as Uint8Array);
    levels.push(next);
    current = next;
  }

  return { levels, size: leafHashes.length, root: current[0] as Uint8Array };
}

/**
 * Computes the RFC 6962 Merkle Tree Hash over already computed leaf hashes.
 *
 * @param leafHashes - Leaf hashes in tree order.
 * @returns The tree root. The empty tree hashes to SHA-256 of the empty string.
 */
export function rootFromLeafHashes(leafHashes: readonly Uint8Array[]): Uint8Array {
  return buildTree(leafHashes).root;
}

/**
 * Computes the RFC 6962 Merkle Tree Hash over entry bytes, hashing each entry
 * as a leaf first.
 *
 * @param entries - Canonical bytes of each entry, in tree order.
 * @returns The tree root.
 */
export function merkleRoot(entries: readonly Uint8Array[]): Uint8Array {
  return rootFromLeafHashes(entries.map(leafHash));
}

/**
 * Computes the Merkle Tree Hash of a contiguous slice of leaf hashes. Used by
 * consistency proof generation, which is defined over subranges.
 *
 * @param leafHashes - The full leaf hash list.
 * @param start - Inclusive start index.
 * @param end - Exclusive end index.
 * @returns The root of the subtree covering that range.
 */
export function rootOfRange(
  leafHashes: readonly Uint8Array[],
  start: number,
  end: number,
): Uint8Array {
  return rootFromLeafHashes(leafHashes.slice(start, end));
}
