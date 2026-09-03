import { parseDigest, toHex } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';

import { ecosystemSlug } from './ecosystem.js';
import type { Ecosystem } from './ecosystem.js';

/** Filename of the manifest inside a snapshot directory. */
export const MANIFEST_FILE = 'manifest.json';

/** Directory holding content addressed record files. */
export const RECORDS_DIR = 'records';

/** Directory holding one lookup index per ecosystem. */
export const INDEX_DIR = 'index';

/**
 * Number of hex characters used to shard the record directory. A full OSV feed
 * is well past a hundred thousand records, and one flat directory of that size
 * is slow to list on every filesystem that matters.
 */
const SHARD_WIDTH = 2;

/**
 * Returns the path of a record file relative to the snapshot root, using forward
 * slashes so the value is identical on every platform.
 *
 * @param recordDigest - The record's digest.
 * @returns A relative path such as `records/1f/1f2a....json`.
 */
export function recordPath(recordDigest: Digest): string {
  const hex = toHex(parseDigest(recordDigest));
  return `${RECORDS_DIR}/${hex.slice(0, SHARD_WIDTH)}/${hex}.json`;
}

/**
 * Returns the path of an ecosystem index file relative to the snapshot root.
 *
 * @param ecosystem - The ecosystem.
 * @returns A relative path such as `index/npm.json`.
 */
export function indexPath(ecosystem: Ecosystem): string {
  return `${INDEX_DIR}/${ecosystemSlug(ecosystem)}.json`;
}
