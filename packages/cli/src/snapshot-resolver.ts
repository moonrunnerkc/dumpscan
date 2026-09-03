import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { isDigest, parseJson } from '@dumpscan/canon';
import { MANIFEST_FILE, parseManifest } from '@dumpscan/osv';
import { readFileSync } from 'node:fs';

import { UsageError } from './exit.js';

/** Where snapshots resolved by digest are cached. */
export const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'dumpscan', 'snapshots');

/**
 * Resolves a snapshot reference to a directory on disk.
 *
 * A reference is either a path to a snapshot directory or a feed digest. A
 * digest is looked up in the local cache, where each snapshot lives in a
 * directory named after its feed digest; every candidate's manifest is read and
 * its feed digest checked, so a directory renamed by hand cannot pass itself off
 * as a snapshot it is not.
 *
 * @param reference - A path or a `sha256:` feed digest.
 * @param cacheDir - Cache directory, defaulting to {@link DEFAULT_CACHE_DIR}.
 * @returns The snapshot directory.
 * @throws UsageError when the reference resolves to nothing.
 */
export function resolveSnapshot(reference: string, cacheDir?: string): string {
  if (!isDigest(reference)) {
    if (existsSync(join(reference, MANIFEST_FILE))) return reference;
    throw new UsageError(
      `dumpscan: ${reference} is neither a snapshot directory nor a sha256: feed digest; build one with dumpscan snapshot, or pass the digest of one already in the cache`,
    );
  }

  const cache = cacheDir === undefined || cacheDir === '' ? DEFAULT_CACHE_DIR : cacheDir;
  for (const candidate of candidates(cache)) {
    const manifestPath = join(candidate, MANIFEST_FILE);
    if (!existsSync(manifestPath)) continue;
    const manifest = parseManifest(parseJson(readFileSync(manifestPath, 'utf8')), manifestPath);
    if (manifest.feedDigest === reference) return candidate;
  }

  throw new UsageError(
    `dumpscan: no snapshot with feed digest ${reference} in ${cache}; fetch it with dumpscan snapshot --from <store>, or pass the path of a snapshot directory`,
  );
}

function candidates(cache: string): string[] {
  if (!existsSync(cache)) return [];
  return readdirSync(cache)
    .sort()
    .map((entry) => join(cache, entry))
    .filter((path) => statSync(path).isDirectory());
}
