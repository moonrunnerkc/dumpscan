import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { canonicalBytes, compareCodeUnits, digest, parseJson } from '@dumpscan/canon';
import type { Digest, JsonObject } from '@dumpscan/canon';

import { advisoryEcosystems, parseAdvisory } from './advisory.js';
import { baseEcosystem, ECOSYSTEMS, isEcosystem, normalizePackageName } from './ecosystem.js';
import type { Ecosystem } from './ecosystem.js';
import { indexPath, MANIFEST_FILE, recordPath } from './snapshot-layout.js';
import {
  ecosystemRoot,
  feedRoot,
  manifestDigest,
  manifestToJson,
  MANIFEST_VERSION,
  sortDigests,
} from './snapshot-manifest.js';
import type { SnapshotEcosystem, SnapshotManifest, SnapshotSource } from './snapshot-manifest.js';

export interface BuildSnapshotOptions {
  /** Ecosystems to include. Records for anything else are dropped. */
  readonly ecosystems?: readonly Ecosystem[];
  /** Download provenance per ecosystem, recorded verbatim in the manifest. */
  readonly sources?: Readonly<Partial<Record<Ecosystem, SnapshotSource>>>;
}

export interface BuildSnapshotResult {
  readonly manifest: SnapshotManifest;
  readonly manifestDigest: Digest;
  readonly feedDigest: Digest;
  /** Records written, counted once even when they affect several ecosystems. */
  readonly recordsWritten: number;
  /** Records parsed but dropped because no affected ecosystem was requested. */
  readonly recordsSkipped: number;
}

interface EcosystemAccumulator {
  readonly digests: Set<Digest>;
  readonly packages: Map<string, Set<Digest>>;
}

/**
 * Builds a content addressed snapshot from a directory of OSV JSON records.
 *
 * The build touches neither the network nor the clock. Given the same input
 * bytes it writes the same files with the same contents in any directory on any
 * machine, which is the property the feed digest depends on.
 *
 * @param recordsDir - Directory searched recursively for `.json` OSV records.
 * @param outDir - Directory to write the snapshot into. Created if absent.
 * @param options - Ecosystem selection and download provenance.
 * @returns The manifest, its digest, and record counts.
 * @throws Error when a record is unparseable or declares an unsupported OSV
 * schema major version.
 */
export function buildSnapshot(
  recordsDir: string,
  outDir: string,
  options: BuildSnapshotOptions = {},
): BuildSnapshotResult {
  const wanted = options.ecosystems ?? ECOSYSTEMS;
  const accumulators = new Map<Ecosystem, EcosystemAccumulator>(
    wanted.map((ecosystem) => [ecosystem, { digests: new Set(), packages: new Map() }]),
  );

  const bodies = new Map<Digest, Uint8Array>();
  const schemaVersions = new Set<string>();
  let recordsSkipped = 0;

  for (const file of listJsonFiles(recordsDir)) {
    const advisory = parseAdvisory(
      parseJson(readFileSync(file, 'utf8')),
      relativeName(recordsDir, file),
    );
    const bytes = canonicalBytes(advisory.document);
    const recordDigest = digest(bytes);

    let used = false;
    for (const name of advisoryEcosystems(advisory)) {
      if (!isEcosystem(name)) continue;
      const accumulator = accumulators.get(name);
      if (accumulator === undefined) continue;
      accumulator.digests.add(recordDigest);
      used = true;
      for (const affected of advisory.affected) {
        if (baseEcosystem(affected.ecosystem) !== name) continue;
        const key = normalizePackageName(name, affected.name);
        const bucket = accumulator.packages.get(key) ?? new Set<Digest>();
        bucket.add(recordDigest);
        accumulator.packages.set(key, bucket);
      }
    }

    if (!used) {
      recordsSkipped += 1;
      continue;
    }
    bodies.set(recordDigest, bytes);
    schemaVersions.add(advisory.schemaVersion);
  }

  const entries: SnapshotEcosystem[] = [...accumulators.entries()]
    .map(([ecosystem, accumulator]) => ({
      ecosystem,
      recordCount: accumulator.digests.size,
      root: ecosystemRoot([...accumulator.digests]),
      source: options.sources?.[ecosystem] ?? null,
    }))
    .sort((a, b) => compareCodeUnits(a.ecosystem, b.ecosystem));

  const manifest: SnapshotManifest = {
    manifestVersion: MANIFEST_VERSION,
    feedDigest: feedRoot(entries),
    recordCount: bodies.size,
    osvSchemaVersions: [...schemaVersions].sort(compareCodeUnits),
    ecosystems: entries,
  };

  writeSnapshot(outDir, manifest, bodies, accumulators);

  return {
    manifest,
    manifestDigest: manifestDigest(manifest),
    feedDigest: manifest.feedDigest,
    recordsWritten: bodies.size,
    recordsSkipped,
  };
}

function writeSnapshot(
  outDir: string,
  manifest: SnapshotManifest,
  bodies: ReadonlyMap<Digest, Uint8Array>,
  accumulators: ReadonlyMap<Ecosystem, EcosystemAccumulator>,
): void {
  for (const recordDigest of sortDigests([...bodies.keys()])) {
    writeFile(
      join(outDir, ...recordPath(recordDigest).split('/')),
      bodies.get(recordDigest) as Uint8Array,
    );
  }

  for (const [ecosystem, accumulator] of accumulators) {
    const packages: Record<string, Digest[]> = {};
    for (const [name, digests] of accumulator.packages) {
      packages[name] = sortDigests([...digests]);
    }
    const document: JsonObject = { ecosystem, packages };
    writeFile(join(outDir, ...indexPath(ecosystem).split('/')), canonicalBytes(document));
  }

  writeFile(join(outDir, MANIFEST_FILE), canonicalBytes(manifestToJson(manifest)));
}

function writeFile(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function listJsonFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort(compareCodeUnits)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.json')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function relativeName(root: string, file: string): string {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return file.startsWith(prefix) ? file.slice(prefix.length).split(sep).join('/') : file;
}
