import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalBytes, isDigest, parseDigest, parseJson, toHex } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { manifestDigest, MANIFEST_FILE, parseManifest } from '@dumpscan/osv';
import {
  parseSnapshotStatement,
  SNAPSHOT_MANIFEST_SUBJECT,
  snapshotStatementToJson,
} from '@dumpscan/predicate';
import {
  envelopePayload,
  payloadBinding,
  readBundleParts,
  verifyPlainKey,
  verifySigstoreBundle,
} from '@dumpscan/sign';

import { UsageError } from './exit.js';
import { ARCHIVE_EXTENSION, unpackSnapshot } from './snapshot-archive.js';

/** Filename of the date to digest index a store publishes. */
export const INDEX_FILE = 'index.json';

export interface FetchOptions {
  /** Ordered list of base URLs to try. The first that has the digest wins. */
  readonly stores: readonly string[];
  readonly cacheDir: string;
  readonly fetchImpl?: typeof fetch;
  /** Expected certificate issuer for the snapshot attestation. */
  readonly issuer?: string;
  /** Expected certificate identity for the snapshot attestation. */
  readonly identity?: string;
  /** Skip attestation verification. Opt in only, and it says so out loud. */
  readonly insecure?: boolean;
}

export interface FetchResult {
  readonly directory: string;
  readonly store: string;
  readonly verified: boolean;
  readonly notes: readonly string[];
}

/**
 * Fetches a snapshot by feed digest from the first configured store that has it.
 *
 * The attestation is verified before the bytes are trusted, and the unpacked
 * manifest's own feed digest is checked against the one that was asked for. A
 * store that serves the wrong snapshot under the right name fails here rather
 * than producing a scan pinned to something nobody asked for.
 *
 * @param feedDigest - The feed digest to fetch.
 * @param options - Stores, cache directory, and verification expectations.
 * @returns Where the snapshot landed and whether its attestation verified.
 * @throws UsageError when no store has the digest, or the bytes do not match it.
 */
export async function fetchSnapshot(
  feedDigest: Digest,
  options: FetchOptions,
): Promise<FetchResult> {
  if (!isDigest(feedDigest)) {
    throw new UsageError(`dumpscan: ${JSON.stringify(feedDigest)} is not a sha256: feed digest`);
  }
  if (options.stores.length === 0) {
    throw new UsageError(
      `dumpscan: no snapshot store is configured, so ${feedDigest} cannot be fetched; pass --store <url> or set DUMPSCAN_STORES`,
    );
  }

  const request = options.fetchImpl ?? globalThis.fetch;
  const hex = toHex(parseDigest(feedDigest));
  const attempts: string[] = [];

  for (const store of options.stores) {
    const base = store.replace(/\/+$/, '');
    const archiveUrl = `${base}/${hex}${ARCHIVE_EXTENSION}`;
    const response = await request(archiveUrl);
    if (!response.ok) {
      attempts.push(`${archiveUrl} responded ${response.status}`);
      continue;
    }

    const archive = new Uint8Array(await response.arrayBuffer());
    const target = join(options.cacheDir, hex);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    unpackSnapshot(archive, target, archiveUrl);

    const manifestPath = join(target, MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
      rmSync(target, { recursive: true, force: true });
      throw new UsageError(
        `dumpscan: the archive at ${archiveUrl} has no ${MANIFEST_FILE}; it is not a dumpscan snapshot`,
      );
    }

    const manifest = parseManifest(parseJson(readFileSync(manifestPath, 'utf8')), manifestPath);
    if (manifest.feedDigest !== feedDigest) {
      rmSync(target, { recursive: true, force: true });
      throw new UsageError(
        `dumpscan: ${archiveUrl} unpacked to a snapshot whose feed digest is ${manifest.feedDigest}, and ${feedDigest} was asked for; the store is serving the wrong snapshot under that name`,
      );
    }

    const notes = await verifyAttestation(base, hex, manifest, request, options);
    return {
      directory: target,
      store: base,
      verified: notes.verified,
      notes: notes.notes,
    };
  }

  throw new UsageError(
    `dumpscan: no configured store has ${feedDigest}. Tried:\n  ${attempts.join('\n  ')}`,
  );
}

/**
 * Reads a store's date to digest index.
 *
 * @param store - Base URL of the store.
 * @param fetchImpl - Override for tests.
 * @returns Date to feed digest, as the store published it.
 * @throws UsageError when the index cannot be read.
 */
export async function readStoreIndex(
  store: string,
  fetchImpl?: typeof fetch,
): Promise<Record<string, string>> {
  const request = fetchImpl ?? globalThis.fetch;
  const url = `${store.replace(/\/+$/, '')}/${INDEX_FILE}`;
  const response = await request(url);
  if (!response.ok) {
    throw new UsageError(`dumpscan: ${url} responded ${response.status} ${response.statusText}`);
  }
  const document = parseJson(await response.text());
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new UsageError(`dumpscan: ${url} is not a date to digest index`);
  }
  const out: Record<string, string> = {};
  for (const [date, value] of Object.entries(document as Record<string, unknown>)) {
    if (typeof value === 'string') out[date] = value;
  }
  return out;
}

async function verifyAttestation(
  base: string,
  hex: string,
  manifest: ReturnType<typeof parseManifest>,
  request: typeof fetch,
  options: FetchOptions,
): Promise<{ verified: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (options.insecure === true) {
    return {
      verified: false,
      notes: ['attestation verification was skipped because --insecure was passed'],
    };
  }

  const url = `${base}/${hex}.att.json`;
  const response = await request(url);
  if (!response.ok) {
    throw new UsageError(
      `dumpscan: ${url} responded ${response.status}; a published snapshot has to carry its attestation, so pass --insecure only if you have another reason to trust these bytes`,
    );
  }

  const parts = readBundleParts(await response.text(), url);
  const statement = parseSnapshotStatement(parts.statement, `${url} statement`);
  const subject = statement.subject.find((entry) => entry.name === SNAPSHOT_MANIFEST_SUBJECT);
  const claimed: Digest | null = subject === undefined ? null : `sha256:${subject.digest.sha256}`;
  const observed = manifestDigest(manifest);

  if (claimed !== observed) {
    throw new UsageError(
      `dumpscan: ${url} attests manifest ${claimed ?? 'nothing'} and the archive unpacked to ${observed}; the attestation does not cover these bytes`,
    );
  }
  if (statement.predicate.feedDigest !== manifest.feedDigest) {
    throw new UsageError(
      `dumpscan: ${url} attests feed ${statement.predicate.feedDigest} and the manifest says ${manifest.feedDigest}`,
    );
  }

  if (parts.attestation === null) {
    throw new UsageError(
      `dumpscan: ${url} carries no signature; a published snapshot has to be signed`,
    );
  }

  const expected = canonicalBytes(snapshotStatementToJson(statement));

  if (parts.attestation.kind === 'plain-key') {
    const envelope = parts.attestation.envelope;
    if (!verifyPlainKey(envelope, parts.attestation.publicKeyPem)) {
      throw new UsageError(`dumpscan: the signature on ${url} does not verify`);
    }
    const binding = payloadBinding(expected, envelopePayload(envelope), envelope.payloadType);
    if (!binding.passed) {
      throw new UsageError(`dumpscan: ${url}: ${binding.detail}`);
    }
    notes.push('signed with a plain key, which binds this snapshot to no identity');
    return { verified: true, notes };
  }

  const checks = await verifySigstoreBundle(parts.attestation.bundle, expected, {
    ...(options.issuer === undefined ? {} : { issuer: options.issuer }),
    ...(options.identity === undefined ? {} : { identity: options.identity }),
  });
  const failed = checks.filter((check) => !check.passed && check.name !== 'identity');
  if (failed.length > 0) {
    throw new UsageError(
      `dumpscan: the attestation at ${url} did not verify: ${failed.map((check) => check.detail).join('; ')}`,
    );
  }
  for (const check of checks) notes.push(`${check.name}: ${check.detail}`);
  return { verified: true, notes };
}
