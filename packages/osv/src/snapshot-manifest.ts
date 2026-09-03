import {
  canonicalBytes,
  compareBytes,
  compareCodeUnits,
  digest,
  formatDigest,
  isDigest,
  isJsonArray,
  isJsonObject,
  parseDigest,
} from '@dumpscan/canon';
import type { Digest, JsonObject, JsonValue } from '@dumpscan/canon';
import { leafHash, rootFromLeafHashes } from '@dumpscan/merkle';

/** Version tag written into every snapshot manifest dumpscan produces. */
export const MANIFEST_VERSION = 'dumpscan.snapshot/v1';

export interface SnapshotSource {
  readonly url: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface SnapshotEcosystem {
  readonly ecosystem: string;
  readonly recordCount: number;
  readonly root: Digest;
  readonly source: SnapshotSource | null;
}

export interface SnapshotManifest {
  readonly manifestVersion: string;
  readonly feedDigest: Digest;
  readonly recordCount: number;
  readonly osvSchemaVersions: readonly string[];
  readonly ecosystems: readonly SnapshotEcosystem[];
}

/**
 * Roots one ecosystem's advisories. The leaves are the record digests
 * themselves, sorted by their raw bytes, so an inclusion proof for an advisory
 * needs only that advisory's hash and never the rest of the feed.
 *
 * @param recordDigests - Digests of every record in the ecosystem.
 * @returns The ecosystem Merkle root.
 */
export function ecosystemRoot(recordDigests: readonly Digest[]): Digest {
  const leaves = sortDigests(recordDigests).map((value) => leafHash(parseDigest(value)));
  return formatDigest(rootFromLeafHashes(leaves));
}

/**
 * Roots the ecosystem entries into the feed digest. Each leaf is the canonical
 * JSON of the ecosystem name, its record count, and its root, so a feed digest
 * commits to which ecosystems were consulted and not only to their contents.
 *
 * @param ecosystems - Ecosystem entries, in any order.
 * @returns The top level Merkle root, which is the feed digest.
 */
export function feedRoot(ecosystems: readonly SnapshotEcosystem[]): Digest {
  const ordered = [...ecosystems].sort((a, b) => compareCodeUnits(a.ecosystem, b.ecosystem));
  const leaves = ordered.map((entry) =>
    leafHash(
      canonicalBytes({
        ecosystem: entry.ecosystem,
        recordCount: entry.recordCount,
        root: entry.root,
      }),
    ),
  );
  return formatDigest(rootFromLeafHashes(leaves));
}

/**
 * Sorts digests by their raw hash bytes rather than their textual form. The two
 * orderings agree for lowercase hex, but sorting the bytes is what RFC 6962
 * consumers expect and does not depend on the digest prefix.
 *
 * @param digests - Digests to order.
 * @returns A new sorted array.
 */
export function sortDigests(digests: readonly Digest[]): Digest[] {
  return [...digests].sort((a, b) => compareBytes(parseDigest(a), parseDigest(b)));
}

/**
 * Renders a manifest as the JSON value that gets canonicalized and hashed.
 *
 * @param manifest - The manifest to render.
 * @returns A plain JSON object.
 */
export function manifestToJson(manifest: SnapshotManifest): JsonObject {
  return {
    manifestVersion: manifest.manifestVersion,
    feedDigest: manifest.feedDigest,
    recordCount: manifest.recordCount,
    osvSchemaVersions: [...manifest.osvSchemaVersions],
    ecosystems: manifest.ecosystems.map((entry) => ({
      ecosystem: entry.ecosystem,
      recordCount: entry.recordCount,
      root: entry.root,
      source:
        entry.source === null
          ? null
          : {
              url: entry.source.url,
              etag: entry.source.etag,
              lastModified: entry.source.lastModified,
            },
    })),
  };
}

/**
 * Computes the digest of a manifest, which the predicate carries as
 * `snapshotManifestDigest`.
 *
 * @param manifest - The manifest to hash.
 * @returns The digest of its canonical bytes.
 */
export function manifestDigest(manifest: SnapshotManifest): Digest {
  return digest(canonicalBytes(manifestToJson(manifest)));
}

/**
 * Parses a manifest read back from disk.
 *
 * @param value - The parsed JSON of a manifest file.
 * @param origin - Where it came from, used in error messages.
 * @returns The manifest.
 * @throws Error when a required field is missing or malformed, or when the
 * manifest version is one this build does not understand.
 */
export function parseManifest(value: JsonValue, origin: string): SnapshotManifest {
  if (!isJsonObject(value)) {
    throw new Error(`parseManifest: ${origin} is not a JSON object; expected a snapshot manifest`);
  }
  const manifestVersion = value['manifestVersion'];
  if (manifestVersion !== MANIFEST_VERSION) {
    throw new Error(
      `parseManifest: ${origin} declares manifestVersion ${JSON.stringify(manifestVersion)}, and this build writes ${MANIFEST_VERSION}; use a dumpscan that matches the snapshot rather than reading it approximately`,
    );
  }
  const ecosystems = value['ecosystems'];
  if (!isJsonArray(ecosystems)) {
    throw new Error(`parseManifest: ${origin} has no ecosystems array`);
  }
  return {
    manifestVersion: MANIFEST_VERSION,
    feedDigest: requireDigest(value['feedDigest'], `${origin} feedDigest`),
    recordCount: requireCount(value['recordCount'], `${origin} recordCount`),
    osvSchemaVersions: requireStrings(value['osvSchemaVersions'], `${origin} osvSchemaVersions`),
    ecosystems: ecosystems.map((entry, i) => parseEcosystem(entry, `${origin} ecosystems[${i}]`)),
  };
}

function parseEcosystem(value: JsonValue, origin: string): SnapshotEcosystem {
  if (!isJsonObject(value)) {
    throw new Error(`parseManifest: ${origin} is not a JSON object`);
  }
  const ecosystem = value['ecosystem'];
  if (typeof ecosystem !== 'string' || ecosystem === '') {
    throw new Error(`parseManifest: ${origin} has no ecosystem name`);
  }
  return {
    ecosystem,
    recordCount: requireCount(value['recordCount'], `${origin} recordCount`),
    root: requireDigest(value['root'], `${origin} root`),
    source: parseSource(value['source'], `${origin} source`),
  };
}

function parseSource(value: JsonValue | undefined, origin: string): SnapshotSource | null {
  if (value === undefined || value === null) return null;
  if (!isJsonObject(value)) {
    throw new Error(`parseManifest: ${origin} is neither null nor an object`);
  }
  const url = value['url'];
  if (typeof url !== 'string') {
    throw new Error(
      `parseManifest: ${origin} has no url; a recorded source must say where it came from`,
    );
  }
  return {
    url,
    etag: typeof value['etag'] === 'string' ? value['etag'] : null,
    lastModified: typeof value['lastModified'] === 'string' ? value['lastModified'] : null,
  };
}

function requireDigest(value: JsonValue | undefined, origin: string): Digest {
  if (typeof value !== 'string' || !isDigest(value)) {
    throw new Error(
      `parseManifest: ${origin} is ${JSON.stringify(value ?? null)}, not a sha256: digest`,
    );
  }
  return value;
}

function requireCount(value: JsonValue | undefined, origin: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `parseManifest: ${origin} is ${JSON.stringify(value ?? null)}, not a non-negative integer`,
    );
  }
  return value;
}

function requireStrings(value: JsonValue | undefined, origin: string): string[] {
  if (value === undefined || !isJsonArray(value)) {
    throw new Error(`parseManifest: ${origin} is not an array of strings`);
  }
  return value.map((item, i) => {
    if (typeof item !== 'string') {
      throw new Error(`parseManifest: ${origin}[${i}] is not a string`);
    }
    return item;
  });
}
