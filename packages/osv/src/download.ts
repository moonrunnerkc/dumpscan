import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { compareCodeUnits } from '@dumpscan/canon';
import { unzipSync } from 'fflate';

import { ecosystemSlug } from './ecosystem.js';
import type { Ecosystem } from './ecosystem.js';
import type { SnapshotSource } from './snapshot-manifest.js';

/** Where OSV publishes the per-ecosystem archives. */
export const DEFAULT_OSV_BASE_URL = 'https://osv-vulnerabilities.storage.googleapis.com';

export interface DownloadOptions {
  /** Ecosystems to fetch. */
  readonly ecosystems: readonly Ecosystem[];
  /** Directory to unpack records into, one subdirectory per ecosystem. */
  readonly outDir: string;
  /** Override for a mirror. Defaults to {@link DEFAULT_OSV_BASE_URL}. */
  readonly baseUrl?: string;
  /** Override for tests. Defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface DownloadedEcosystem {
  readonly ecosystem: Ecosystem;
  readonly source: SnapshotSource;
  readonly recordCount: number;
  readonly recordsDir: string;
}

/**
 * Fetches the OSV `all.zip` archives and unpacks them to disk, recording the
 * ETag and Last-Modified observed at download time.
 *
 * Downloading is kept apart from {@link buildSnapshot} on purpose. The builder
 * has to be a pure function of bytes on disk for the feed digest to mean
 * anything, and it cannot be that if it also decides what to fetch.
 *
 * @param options - Ecosystems, output directory, and optional overrides.
 * @returns One entry per ecosystem with its provenance and record count.
 * @throws Error when a request fails or an archive cannot be read.
 */
export async function downloadEcosystems(options: DownloadOptions): Promise<DownloadedEcosystem[]> {
  const baseUrl = (options.baseUrl ?? DEFAULT_OSV_BASE_URL).replace(/\/+$/, '');
  const request = options.fetchImpl ?? globalThis.fetch;
  const out: DownloadedEcosystem[] = [];

  for (const ecosystem of options.ecosystems) {
    const url = `${baseUrl}/${encodeURIComponent(ecosystem)}/all.zip`;
    const response = await request(url);
    if (!response.ok) {
      throw new Error(
        `downloadEcosystems: ${url} responded ${response.status} ${response.statusText}; check the mirror is reachable and spells the ecosystem the way OSV does`,
      );
    }
    const archive = new Uint8Array(await response.arrayBuffer());
    const recordsDir = join(options.outDir, ecosystemSlug(ecosystem));
    const recordCount = unpack(archive, recordsDir, url);

    out.push({
      ecosystem,
      recordsDir,
      recordCount,
      source: {
        url,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      },
    });
  }

  return out;
}

function unpack(archive: Uint8Array, recordsDir: string, url: string): number {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive);
  } catch (error) {
    throw new Error(
      `downloadEcosystems: ${url} did not decode as a zip archive; the mirror may be serving an error page with a 200 status`,
      { cause: error },
    );
  }

  let count = 0;
  for (const name of Object.keys(entries).sort(compareCodeUnits)) {
    if (!name.endsWith('.json')) continue;
    const body = entries[name];
    if (body === undefined) continue;
    const target = join(
      recordsDir,
      ...name.split('/').filter((part) => part !== '' && part !== '..'),
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    count += 1;
  }
  return count;
}
