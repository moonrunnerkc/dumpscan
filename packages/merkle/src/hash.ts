import { createHash } from 'node:crypto';

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

/**
 * Hashes bytes with SHA-256. `merkle` has no dependencies, so it carries its
 * own hash rather than reaching for `canon`.
 *
 * @param bytes - The bytes to hash.
 * @returns The 32 byte digest.
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(bytes).digest());
}

/**
 * Computes the RFC 6962 leaf hash, `SHA-256(0x00 || data)`. The prefix is what
 * stops a leaf from being reinterpreted as an internal node.
 *
 * @param data - The canonical bytes of the entry.
 * @returns The leaf hash.
 */
export function leafHash(data: Uint8Array): Uint8Array {
  const buffer = new Uint8Array(data.length + 1);
  buffer[0] = LEAF_PREFIX;
  buffer.set(data, 1);
  return sha256(buffer);
}

/**
 * Computes the RFC 6962 internal node hash, `SHA-256(0x01 || left || right)`.
 *
 * @param left - Left child hash.
 * @param right - Right child hash.
 * @returns The node hash.
 */
export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  const buffer = new Uint8Array(left.length + right.length + 1);
  buffer[0] = NODE_PREFIX;
  buffer.set(left, 1);
  buffer.set(right, left.length + 1);
  return sha256(buffer);
}

/**
 * Reports whether two hashes are equal, in constant time with respect to
 * position so a caller cannot learn where they diverge from timing alone.
 *
 * @param a - Left hash.
 * @param b - Right hash.
 * @returns True when both have the same length and content.
 */
export function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= (a[i] as number) ^ (b[i] as number);
  }
  return difference === 0;
}

/** RFC 6962 defines the root of the empty tree as the hash of the empty string. */
export const EMPTY_TREE_ROOT: Uint8Array = sha256(new Uint8Array(0));
