import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { digest, isDigest, isJsonObject, parseJson } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';

import { parseAdvisory } from './advisory.js';
import type { OsvAdvisory } from './advisory.js';
import { isEcosystem } from './ecosystem.js';
import type { Ecosystem } from './ecosystem.js';
import { indexPath, MANIFEST_FILE, recordPath } from './snapshot-layout.js';
import { parseManifest } from './snapshot-manifest.js';
import type { SnapshotManifest } from './snapshot-manifest.js';

/**
 * The read side the matcher depends on. Deliberately narrow: an implementation
 * can be backed by files, by an archive, or by an array held in a test, and the
 * matcher cannot tell the difference or reach past it.
 */
export interface AdvisorySource {
  readonly ecosystems: readonly Ecosystem[];
  advisoriesFor(ecosystem: Ecosystem, normalizedName: string): readonly OsvAdvisory[];
}

export interface Snapshot extends AdvisorySource {
  readonly manifest: SnapshotManifest;
  readonly feedDigest: Digest;
  readonly root: string;
  /** Digests of the advisories indexed under a package name, in tree order. */
  digestsFor(ecosystem: Ecosystem, normalizedName: string): readonly Digest[];
  /** Reads and verifies one record by digest. */
  readAdvisory(recordDigest: Digest): OsvAdvisory;
}

/**
 * Opens a snapshot directory. The manifest is read immediately; ecosystem
 * indexes and record files are read on first use and cached, so a scan of a
 * twenty package lockfile does not pay for a hundred thousand record feed.
 *
 * @param root - Path to the snapshot directory.
 * @returns The snapshot reader.
 * @throws Error when the directory has no manifest or the manifest is malformed.
 */
export function openSnapshot(root: string): Snapshot {
  const manifestPath = join(root, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `openSnapshot: ${root} has no ${MANIFEST_FILE}; point at a snapshot directory built by dumpscan snapshot, not at its records subdirectory`,
    );
  }
  const manifest = parseManifest(parseJson(readFileSync(manifestPath, 'utf8')), manifestPath);
  const ecosystems = manifest.ecosystems
    .map((entry) => entry.ecosystem)
    .filter((name): name is Ecosystem => isEcosystem(name));

  const indexes = new Map<Ecosystem, ReadonlyMap<string, readonly Digest[]>>();
  const records = new Map<Digest, OsvAdvisory>();

  const indexFor = (ecosystem: Ecosystem): ReadonlyMap<string, readonly Digest[]> => {
    const cached = indexes.get(ecosystem);
    if (cached !== undefined) return cached;
    const loaded = loadIndex(root, ecosystem);
    indexes.set(ecosystem, loaded);
    return loaded;
  };

  const readAdvisory = (recordDigest: Digest): OsvAdvisory => {
    const cached = records.get(recordDigest);
    if (cached !== undefined) return cached;
    const path = join(root, ...recordPath(recordDigest).split('/'));
    const bytes = readFileSync(path);
    const actual = digest(bytes);
    if (actual !== recordDigest) {
      throw new Error(
        `openSnapshot: ${path} hashes to ${actual} but the index refers to it as ${recordDigest}; the snapshot has been modified after it was written and cannot be trusted`,
      );
    }
    const advisory = parseAdvisory(parseJson(bytes.toString('utf8')), path);
    records.set(recordDigest, advisory);
    return advisory;
  };

  const digestsFor = (ecosystem: Ecosystem, normalizedName: string): readonly Digest[] =>
    indexFor(ecosystem).get(normalizedName) ?? [];

  return {
    manifest,
    feedDigest: manifest.feedDigest,
    root,
    ecosystems,
    digestsFor,
    readAdvisory,
    advisoriesFor: (ecosystem, normalizedName) =>
      digestsFor(ecosystem, normalizedName).map(readAdvisory),
  };
}

function loadIndex(root: string, ecosystem: Ecosystem): ReadonlyMap<string, readonly Digest[]> {
  const path = join(root, ...indexPath(ecosystem).split('/'));
  const out = new Map<string, readonly Digest[]>();
  if (!existsSync(path)) return out;

  const document = parseJson(readFileSync(path, 'utf8'));
  if (!isJsonObject(document)) {
    throw new Error(`openSnapshot: ${path} is not a JSON object; expected an ecosystem index`);
  }
  const packages = document['packages'];
  if (!isJsonObject(packages)) {
    throw new Error(`openSnapshot: ${path} has no packages object`);
  }
  for (const [name, value] of Object.entries(packages)) {
    if (!Array.isArray(value)) {
      throw new Error(
        `openSnapshot: ${path} maps ${JSON.stringify(name)} to something other than a list`,
      );
    }
    const digests: Digest[] = [];
    for (const item of value) {
      if (typeof item !== 'string' || !isDigest(item)) {
        throw new Error(
          `openSnapshot: ${path} lists ${JSON.stringify(item)} under ${JSON.stringify(name)}, which is not a sha256: digest`,
        );
      }
      digests.push(item);
    }
    out.set(name, digests);
  }
  return out;
}

/**
 * Builds an advisory source over records already in memory. Used by tests and by
 * anything that needs matching without a snapshot on disk.
 *
 * @param entries - Advisories keyed by ecosystem and normalized package name.
 * @returns An advisory source.
 */
export function memoryAdvisorySource(
  entries: ReadonlyMap<Ecosystem, ReadonlyMap<string, readonly OsvAdvisory[]>>,
): AdvisorySource {
  return {
    ecosystems: [...entries.keys()],
    advisoriesFor: (ecosystem, normalizedName) => entries.get(ecosystem)?.get(normalizedName) ?? [],
  };
}
