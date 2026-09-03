import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { canonicalBytes, parseDigest, parseJson, toHex } from '@dumpscan/canon';
import { manifestDigest, MANIFEST_FILE, openSnapshot, parseManifest } from '@dumpscan/osv';
import { buildSnapshotStatement, snapshotStatementToJson } from '@dumpscan/predicate';
import type { SnapshotSourceClaim } from '@dumpscan/predicate';
import {
  BUNDLE_VERSION,
  INTOTO_PAYLOAD_TYPE,
  publicKeyFromPrivate,
  signKeyless,
  signPlainKey,
} from '@dumpscan/sign';
import type { Attestation } from '@dumpscan/sign';

import { flag, requireOption } from './args.js';
import type { ParsedArgs } from './args.js';
import { EXIT_OK, UsageError } from './exit.js';
import type { CommandOutput } from './output.js';
import { ARCHIVE_EXTENSION, packSnapshot } from './snapshot-archive.js';
import { INDEX_FILE } from './snapshot-fetch.js';

/**
 * Runs `dumpscan publish`.
 *
 * Packs a snapshot into a deterministic archive named after its feed digest,
 * signs its manifest as an in-toto attestation of its own, and writes both plus
 * a date to digest index into a directory a release or a bucket can be filled
 * from. Publishing the bytes somewhere is the workflow's job; producing exactly
 * the right bytes is this command's.
 *
 * @param args - Parsed arguments.
 * @returns Exit code, human lines, and what was written.
 * @throws UsageError when the snapshot directory is not one.
 */
export async function runPublish(args: ParsedArgs): Promise<CommandOutput> {
  const snapshotDir = args.positional[0];
  if (snapshotDir === undefined) {
    throw new UsageError(
      'dumpscan publish needs a snapshot directory; run dumpscan publish <snapshot-dir> --out <dir>',
    );
  }
  if (!existsSync(join(snapshotDir, MANIFEST_FILE))) {
    throw new UsageError(`dumpscan publish: ${snapshotDir} has no ${MANIFEST_FILE}`);
  }

  // Everything the command needs is read before anything is written, so a wrong
  // command line leaves the output directory as it was rather than half updated.
  const out = requireOption(args, 'out', 'the release assets have to be written somewhere');
  const date = requireOption(
    args,
    'date',
    'the index maps a date to a digest, and dumpscan does not read the clock for you',
  );

  const snapshot = openSnapshot(snapshotDir);
  const manifest = snapshot.manifest;
  const hex = toHex(parseDigest(manifest.feedDigest));

  const archive = packSnapshot(snapshotDir);
  const statement = buildSnapshotStatement(manifestDigest(manifest), {
    feedDigest: manifest.feedDigest,
    recordCount: manifest.recordCount,
    sources: manifest.ecosystems.map((entry): SnapshotSourceClaim => ({
      ecosystem: entry.ecosystem,
      url: entry.source?.url ?? '',
      etag: entry.source?.etag ?? null,
      lastModified: entry.source?.lastModified ?? null,
      recordCount: entry.recordCount,
    })),
  });

  const payload = canonicalBytes(snapshotStatementToJson(statement));
  const attestation = await attest(args, payload);

  mkdirSync(resolve(out), { recursive: true });
  const index = readIndex(join(out, INDEX_FILE));
  index[date] = manifest.feedDigest;

  writeFileSync(join(out, `${hex}${ARCHIVE_EXTENSION}`), archive.bytes);
  writeFileSync(
    join(out, `${hex}.att.json`),
    canonicalBytes({
      bundleVersion: BUNDLE_VERSION,
      statement: snapshotStatementToJson(statement),
      manifest: {},
      findings: [],
      attestation: attestationToJson(attestation),
    }),
  );
  writeFileSync(join(out, INDEX_FILE), canonicalBytes(index));

  return {
    exitCode: EXIT_OK,
    lines: [
      `feed digest   ${manifest.feedDigest}`,
      `archive       ${hex}${ARCHIVE_EXTENSION} (${String(archive.bytes.length)} bytes, ${archive.digest})`,
      `attestation   ${hex}.att.json${attestation === null ? ' (unsigned)' : ''}`,
      `index         ${date} -> ${manifest.feedDigest}`,
      `out           ${out}`,
    ],
    json: {
      feedDigest: manifest.feedDigest,
      archive: `${hex}${ARCHIVE_EXTENSION}`,
      archiveDigest: archive.digest,
      attestation: `${hex}.att.json`,
      signed: attestation !== null,
      date,
      out,
    },
  };
}

async function attest(args: ParsedArgs, payload: Uint8Array): Promise<Attestation | null> {
  const keyPath = args.options.get('key');
  if (keyPath !== undefined && keyPath !== '') {
    const privateKeyPem = readFileSync(keyPath, 'utf8');
    return {
      kind: 'plain-key',
      envelope: signPlainKey(payload, INTOTO_PAYLOAD_TYPE, privateKeyPem),
      publicKeyPem: publicKeyFromPrivate(privateKeyPem),
    };
  }
  if (!flag(args, 'sign')) return null;
  const identityToken = args.options.get('identity-token');
  return signKeyless(payload, {
    ...(identityToken === undefined || identityToken === '' ? {} : { identityToken }),
  });
}

function attestationToJson(attestation: Attestation | null): ReturnType<typeof parseJson> {
  if (attestation === null) return null;
  if (attestation.kind === 'sigstore') return { kind: 'sigstore', bundle: attestation.bundle };
  return {
    kind: 'plain-key',
    envelope: {
      payload: attestation.envelope.payload,
      payloadType: attestation.envelope.payloadType,
      signatures: attestation.envelope.signatures.map((signature) => ({
        sig: signature.sig,
        keyid: signature.keyid,
      })),
    },
    publicKeyPem: attestation.publicKeyPem,
  };
}

function readIndex(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const document = parseJson(readFileSync(path, 'utf8'));
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return {};
  const out: Record<string, string> = {};
  for (const [date, value] of Object.entries(document as Record<string, unknown>)) {
    if (typeof value === 'string') out[date] = value;
  }
  return out;
}

/**
 * Reads a snapshot manifest from a directory, for callers that only need the
 * manifest rather than the whole index.
 *
 * @param snapshotDir - Path to the snapshot.
 * @returns The manifest.
 */
export function readSnapshotManifest(snapshotDir: string): ReturnType<typeof parseManifest> {
  const path = join(snapshotDir, MANIFEST_FILE);
  return parseManifest(parseJson(readFileSync(path, 'utf8')), path);
}
