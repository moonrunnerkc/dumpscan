import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { isDigest, parseJson } from '@dumpscan/canon';
import { MANIFEST_FILE, parseManifest } from '@dumpscan/osv';
import { readFileSync } from 'node:fs';

import { UsageError } from './exit.js';
import { fetchSnapshot } from './snapshot-fetch.js';

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
    `dumpscan: no snapshot with feed digest ${reference} in ${cache}; pass --store <url> to fetch it, or pass the path of a snapshot directory`,
  );
}

export interface ResolveOptions {
  readonly cacheDir?: string;
  /** Ordered store base URLs to try when the cache misses. */
  readonly stores?: readonly string[];
  readonly issuer?: string;
  readonly identity?: string;
  readonly insecure?: boolean;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Resolves a snapshot, falling back to the configured stores when the cache does
 * not have it.
 *
 * The local cache is tried first because a snapshot is immutable: if the digest
 * is already on disk, no store can have a better copy of it.
 *
 * @param reference - A path or a `sha256:` feed digest.
 * @param options - Cache directory, stores, and verification expectations.
 * @returns The snapshot directory.
 * @throws UsageError when neither the cache nor any store has it.
 */
export async function resolveSnapshotWithStores(
  reference: string,
  options: ResolveOptions = {},
): Promise<string> {
  try {
    return resolveSnapshot(reference, options.cacheDir);
  } catch (error) {
    const stores = options.stores ?? [];
    if (!isDigest(reference) || stores.length === 0) throw error;
    const result = await fetchSnapshot(reference, {
      stores,
      cacheDir:
        options.cacheDir === undefined || options.cacheDir === ''
          ? DEFAULT_CACHE_DIR
          : options.cacheDir,
      ...(options.issuer === undefined ? {} : { issuer: options.issuer }),
      ...(options.identity === undefined ? {} : { identity: options.identity }),
      ...(options.insecure === undefined ? {} : { insecure: options.insecure }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
    return result.directory;
  }
}

/**
 * Reads the configured stores from the command line and the environment.
 *
 * `--store` may repeat, and `DUMPSCAN_STORES` holds a comma separated list, so a
 * CI job can configure a mirror once for every dumpscan invocation in it.
 *
 * @param repeated - Values of the repeated `--store` option.
 * @param environment - The process environment.
 * @returns The store base URLs, in the order they should be tried.
 */
export function storesFrom(
  repeated: readonly string[] | undefined,
  environment: Record<string, string | undefined>,
): string[] {
  const fromFlags = (repeated ?? []).flatMap((value) => value.split(','));
  const fromEnv = (environment['DUMPSCAN_STORES'] ?? '').split(',');
  return [...fromFlags, ...fromEnv].map((value) => value.trim()).filter((value) => value !== '');
}

function candidates(cache: string): string[] {
  if (!existsSync(cache)) return [];
  return readdirSync(cache)
    .sort()
    .map((entry) => join(cache, entry))
    .filter((path) => statSync(path).isDirectory());
}
