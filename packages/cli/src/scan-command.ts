import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { canonicalBytes } from '@dumpscan/canon';
import { basename, inputDigest, manifestToJson, parseLockfile } from '@dumpscan/lockfiles';
import type { InputManifest } from '@dumpscan/lockfiles';
import { findingToJson, matchManifest } from '@dumpscan/match';
import { manifestDigest, openSnapshot } from '@dumpscan/osv';
import { buildStatement, statementToJson } from '@dumpscan/predicate';
import type { ScanPredicate } from '@dumpscan/predicate';
import {
  BUNDLE_VERSION,
  bundleBytes,
  INTOTO_PAYLOAD_TYPE,
  publicKeyFromPrivate,
  signKeyless,
  signPlainKey,
} from '@dumpscan/sign';
import type { Attestation, ScanBundle } from '@dumpscan/sign';
import { rulesetDigest } from '@dumpscan/versions';

import { flag, requireOption } from './args.js';
import type { ParsedArgs } from './args.js';
import { EXIT_FINDINGS, EXIT_OK, UsageError } from './exit.js';
import type { CommandOutput } from './output.js';
import { resolveSnapshot } from './snapshot-resolver.js';

/**
 * Runs `dumpscan scan`.
 *
 * The snapshot is never chosen for the caller. Picking the newest one would make
 * two runs of the same command produce different claims, which is the failure
 * dumpscan exists to remove, so `--snapshot` is required and takes a feed digest
 * or a path.
 *
 * @param args - Parsed arguments.
 * @returns Exit code, human lines, and the machine readable report.
 * @throws UsageError when a required option is missing or a path does not exist.
 */
export async function runScan(args: ParsedArgs): Promise<CommandOutput> {
  const lockfilePath = args.positional[0];
  if (lockfilePath === undefined) {
    throw new UsageError(
      'dumpscan scan needs a lockfile path; run dumpscan scan <lockfile> --snapshot <digest|path>',
    );
  }
  if (!existsSync(lockfilePath) || !statSync(lockfilePath).isFile()) {
    throw new UsageError(`dumpscan scan: ${lockfilePath} is not a file`);
  }

  const snapshotRef = requireOption(
    args,
    'snapshot',
    'dumpscan never picks a snapshot for you, because two runs of the same command have to make the same claim; pass the feed digest or the path of the snapshot to scan against',
  );
  const snapshot = openSnapshot(resolveSnapshot(snapshotRef, args.options.get('cache')));

  const parsed = parseLockfile(lockfilePath, readFileSync(lockfilePath));
  const workspace = args.options.get('workspace') ?? '.';
  const manifest = selectManifest(parsed.manifests, workspace, lockfilePath);
  const result = matchManifest(manifest, snapshot);

  const predicate: ScanPredicate = {
    feedDigest: snapshot.feedDigest,
    snapshotManifestDigest: manifestDigest(snapshot.manifest),
    matcherVersion: result.matcherVersion,
    comparatorRulesetDigest: rulesetDigest(),
    exclusionsDigest: null,
    findingsRoot: result.findingsRoot,
    findingsCount: result.findings.length,
    ecosystems: result.ecosystems,
  };

  const statement = buildStatement({
    inputDigest: inputDigest(manifest),
    lockfileDigest: manifest.lockfileDigest,
    lockfileName: basename(lockfilePath),
    predicate,
  });

  const bundle: ScanBundle = {
    bundleVersion: BUNDLE_VERSION,
    statement,
    manifest,
    findings: result.findings,
    attestation: await attest(args, canonicalBytes(statementToJson(statement))),
  };

  const out = args.options.get('out') ?? 'dumpscan.bundle.json';
  write(out, bundleBytes(bundle, manifestToJson, findingToJson));

  const findingsPath = args.options.get('findings');
  if (findingsPath !== undefined && findingsPath !== '') {
    write(findingsPath, canonicalBytes(result.findings.map(findingToJson)));
  }

  const affected = result.findings.filter((finding) => finding.status === 'affected');
  return {
    exitCode: affected.length > 0 ? EXIT_FINDINGS : EXIT_OK,
    lines: [
      `format        ${parsed.format}`,
      `workspace     ${manifest.workspaceRoot}`,
      `input         ${inputDigest(manifest)}`,
      `feed          ${predicate.feedDigest}`,
      `comparators   ${predicate.comparatorRulesetDigest}`,
      `matcher       ${predicate.matcherVersion}`,
      `findings      ${String(result.findings.length)} total, ${String(affected.length)} affected`,
      `findingsRoot  ${predicate.findingsRoot}`,
      `bundle        ${out}`,
    ],
    json: {
      format: parsed.format,
      workspaceRoot: manifest.workspaceRoot,
      inputDigest: inputDigest(manifest),
      statement: statementToJson(statement),
      bundle: out,
      findings: result.findings.map(findingToJson),
    },
  };
}

function selectManifest(
  manifests: readonly InputManifest[],
  workspace: string,
  lockfilePath: string,
): InputManifest {
  const manifest = manifests.find((candidate) => candidate.workspaceRoot === workspace);
  if (manifest !== undefined) return manifest;
  throw new UsageError(
    `dumpscan scan: ${lockfilePath} has no workspace ${JSON.stringify(workspace)}; it resolves ${manifests.map((candidate) => candidate.workspaceRoot).join(', ')}`,
  );
}

async function attest(args: ParsedArgs, payload: Uint8Array): Promise<Attestation | null> {
  const keyPath = args.options.get('key');
  if (keyPath !== undefined && keyPath !== '') {
    const privateKeyPem = readFileSync(keyPath, 'utf8');
    const publicKeyPath = args.options.get('public-key');
    return {
      kind: 'plain-key',
      envelope: signPlainKey(payload, INTOTO_PAYLOAD_TYPE, privateKeyPem),
      publicKeyPem:
        publicKeyPath === undefined || publicKeyPath === ''
          ? publicKeyFromPrivate(privateKeyPem)
          : readFileSync(publicKeyPath, 'utf8'),
    };
  }

  if (!flag(args, 'sign')) return null;
  const identityToken = args.options.get('identity-token');
  return signKeyless(payload, {
    ...(identityToken === undefined || identityToken === '' ? {} : { identityToken }),
  });
}

function write(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, bytes);
}
