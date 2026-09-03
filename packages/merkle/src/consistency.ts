import { hashesEqual, nodeHash } from './hash.js';
import { rootOfRange } from './tree.js';

/**
 * Generates the RFC 6962 consistency proof showing that a tree of `first`
 * leaves is a prefix of the tree over `leafHashes`.
 *
 * @param leafHashes - Leaf hashes of the larger tree, in tree order.
 * @param first - Size of the earlier tree.
 * @returns The consistency path. Empty when the two trees are the same size.
 * @throws RangeError when `first` is not in the range 1 to the tree size.
 */
export function consistencyProof(leafHashes: readonly Uint8Array[], first: number): Uint8Array[] {
  const second = leafHashes.length;
  if (!Number.isInteger(first) || first < 1 || first > second) {
    throw new RangeError(
      `consistencyProof: earlier tree size ${first} must be between 1 and the current size ${second}; a consistency proof only relates a tree to one that grew from it`,
    );
  }
  if (first === second) return [];
  return subProof(leafHashes, 0, second, first, true);
}

function subProof(
  leafHashes: readonly Uint8Array[],
  start: number,
  end: number,
  first: number,
  isCompleteSubtree: boolean,
): Uint8Array[] {
  const size = end - start;
  if (first === size) {
    return isCompleteSubtree ? [] : [rootOfRange(leafHashes, start, end)];
  }
  const split = largestPowerOfTwoBelow(size);
  if (first <= split) {
    const inner = subProof(leafHashes, start, start + split, first, isCompleteSubtree);
    inner.push(rootOfRange(leafHashes, start + split, end));
    return inner;
  }
  const inner = subProof(leafHashes, start + split, end, first - split, false);
  inner.push(rootOfRange(leafHashes, start, start + split));
  return inner;
}

function largestPowerOfTwoBelow(size: number): number {
  let power = 1;
  while (power * 2 < size) power *= 2;
  return power;
}

/**
 * Verifies an RFC 6962 consistency proof, following the algorithm in section
 * 2.1.4. A true result means every entry in the earlier tree is still present,
 * in the same order, in the later one.
 *
 * @param firstRoot - Root of the earlier tree.
 * @param secondRoot - Root of the later tree.
 * @param first - Size of the earlier tree.
 * @param second - Size of the later tree.
 * @param proof - The consistency path.
 * @returns True when the later tree provably extends the earlier one.
 */
export function verifyConsistency(
  firstRoot: Uint8Array,
  secondRoot: Uint8Array,
  first: number,
  second: number,
  proof: readonly Uint8Array[],
): boolean {
  if (!Number.isInteger(first) || !Number.isInteger(second)) return false;
  if (first < 1 || first > second) return false;
  if (first === second) return proof.length === 0 && hashesEqual(firstRoot, secondRoot);

  const path = isPowerOfTwo(first) ? [firstRoot, ...proof] : [...proof];
  const head = path[0];
  if (head === undefined) return false;

  let node = first - 1;
  let last = second - 1;
  while ((node & 1) === 1) {
    node >>= 1;
    last >>= 1;
  }

  let fromFirst = head;
  let fromSecond = head;
  for (const step of path.slice(1)) {
    if (last === 0) return false;
    if ((node & 1) === 1 || node === last) {
      fromFirst = nodeHash(step, fromFirst);
      fromSecond = nodeHash(step, fromSecond);
      while ((node & 1) === 0 && node !== 0) {
        node >>= 1;
        last >>= 1;
      }
    } else {
      fromSecond = nodeHash(fromSecond, step);
    }
    node >>= 1;
    last >>= 1;
  }

  return last === 0 && hashesEqual(fromFirst, firstRoot) && hashesEqual(fromSecond, secondRoot);
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}
