import { hashesEqual, nodeHash } from './hash.js';
import { buildTree } from './tree.js';

/**
 * Generates the RFC 6962 audit path proving that the leaf at `index` is part of
 * the tree over `leafHashes`.
 *
 * @param leafHashes - Leaf hashes in tree order.
 * @param index - Zero based position of the leaf being proved.
 * @returns The sibling hashes from the leaf up to the root.
 * @throws RangeError when the index is outside the tree.
 */
export function inclusionProof(leafHashes: readonly Uint8Array[], index: number): Uint8Array[] {
  if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) {
    throw new RangeError(
      `inclusionProof: index ${index} is outside a tree of ${leafHashes.length} leaves; pass the position of the leaf you are proving`,
    );
  }

  const { levels } = buildTree(leafHashes);
  const proof: Uint8Array[] = [];
  let position = index;
  for (let level = 0; level < levels.length - 1; level += 1) {
    const nodes = levels[level] as readonly Uint8Array[];
    const sibling = position ^ 1;
    if (sibling < nodes.length) proof.push(nodes[sibling] as Uint8Array);
    position >>= 1;
  }
  return proof;
}

/**
 * Verifies an RFC 6962 audit path, following the algorithm in section 2.1.2.
 * The caller supplies the leaf hash, so verification never needs the entry
 * bytes or any other leaf.
 *
 * @param root - The expected tree root.
 * @param leaf - The leaf hash being proved.
 * @param index - Zero based position of the leaf.
 * @param treeSize - Number of leaves in the tree the root came from.
 * @param proof - The audit path.
 * @returns True when the path recomputes the root.
 */
export function verifyInclusion(
  root: Uint8Array,
  leaf: Uint8Array,
  index: number,
  treeSize: number,
  proof: readonly Uint8Array[],
): boolean {
  if (!Number.isInteger(index) || !Number.isInteger(treeSize)) return false;
  if (index < 0 || treeSize <= 0 || index >= treeSize) return false;

  let node = index;
  let last = treeSize - 1;
  let computed = leaf;

  for (const sibling of proof) {
    if (last === 0) return false;
    if ((node & 1) === 1 || node === last) {
      computed = nodeHash(sibling, computed);
      while ((node & 1) === 0 && node !== 0) {
        node >>= 1;
        last >>= 1;
      }
    } else {
      computed = nodeHash(computed, sibling);
    }
    node >>= 1;
    last >>= 1;
  }

  return last === 0 && hashesEqual(computed, root);
}
