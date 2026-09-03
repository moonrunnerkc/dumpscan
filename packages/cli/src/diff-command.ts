import { existsSync } from 'node:fs';

import { isDigest } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { diffScans } from '@dumpscan/diff';
import type { DiffInput, FindingChange } from '@dumpscan/diff';
import { openSnapshot } from '@dumpscan/osv';
import type { OsvAdvisory } from '@dumpscan/osv';
import type { ScanBundle } from '@dumpscan/sign';

import type { ParsedArgs } from './args.js';
import { readBundle } from './bundle-io.js';
import { EXIT_FINDINGS, EXIT_OK, EXIT_UNEXPLAINED, UsageError } from './exit.js';
import type { CommandOutput } from './output.js';
import { resolveOptionsFrom } from './scan-command.js';
import { resolveSnapshotWithStores } from './snapshot-resolver.js';

/**
 * Runs `dumpscan diff`.
 *
 * Compares the four pinned digests, then attributes every changed finding to
 * exactly one of them. A change nothing explains is a bug in dumpscan rather
 * than a fact about the two scans, so it exits 3 and says which finding it could
 * not account for.
 *
 * `--snapshot-a` and `--snapshot-b` are optional. Without them a feed change is
 * reported by the advisory's record digest and modified value, which both
 * bundles already carry; with them the report adds the field level diff of the
 * record itself.
 *
 * @param args - Parsed arguments.
 * @returns Exit code, human lines, and the attribution report.
 * @throws UsageError when either bundle path is missing.
 */
export async function runDiff(args: ParsedArgs): Promise<CommandOutput> {
  const pathA = args.positional[0];
  const pathB = args.positional[1];
  if (pathA === undefined || pathB === undefined) {
    throw new UsageError(
      'dumpscan diff needs two bundle paths; run dumpscan diff <bundle-a> <bundle-b> [--snapshot-a <path>] [--snapshot-b <path>]',
    );
  }

  const bundleA = readBundle(pathA);
  const bundleB = readBundle(pathB);
  const result = diffScans(
    await scanOf(bundleA, args, args.options.get('snapshot-a')),
    await scanOf(bundleB, args, args.options.get('snapshot-b')),
  );

  const lines: string[] = [];
  for (const [name, change] of Object.entries(result.digests)) {
    lines.push(
      change.moved
        ? `${name.padEnd(12)}moved  ${change.before ?? 'none'} -> ${change.after ?? 'none'}`
        : `${name.padEnd(12)}same   ${change.after ?? 'none'}`,
    );
  }

  if (result.changes.length === 0) {
    lines.push('', 'no findings changed');
  } else {
    lines.push('', `${String(result.changes.length)} findings changed`);
    for (const change of result.changes) lines.push(describe(change));
  }

  return {
    exitCode:
      result.unexplained > 0
        ? EXIT_UNEXPLAINED
        : result.changes.length > 0
          ? EXIT_FINDINGS
          : EXIT_OK,
    lines,
    json: {
      before: pathA,
      after: pathB,
      digests: result.digests,
      changes: result.changes,
      unexplained: result.unexplained,
    },
  };
}

function describe(change: FindingChange): string {
  return `  ${change.kind.padEnd(8)}${change.cause.padEnd(12)}${change.key}`;
}

async function scanOf(
  bundle: ScanBundle,
  args: ParsedArgs,
  snapshotRef: string | undefined,
): Promise<DiffInput> {
  const advisories = await loadAdvisories(bundle, args, snapshotRef);
  return {
    predicate: bundle.statement.predicate,
    manifest: bundle.manifest,
    findings: bundle.findings,
    ...(advisories === undefined ? {} : { advisories }),
  };
}

async function loadAdvisories(
  bundle: ScanBundle,
  args: ParsedArgs,
  snapshotRef: string | undefined,
): Promise<Map<Digest, OsvAdvisory> | undefined> {
  if (snapshotRef === undefined || snapshotRef === '') return undefined;
  if (!isDigest(snapshotRef) && !existsSync(snapshotRef)) {
    throw new UsageError(`dumpscan diff: ${snapshotRef} does not exist`);
  }

  const snapshot = openSnapshot(
    await resolveSnapshotWithStores(snapshotRef, resolveOptionsFrom(args)),
  );
  const byDigest = new Map<Digest, OsvAdvisory>();
  for (const finding of bundle.findings) {
    if (byDigest.has(finding.advisoryDigest)) continue;
    try {
      byDigest.set(finding.advisoryDigest, snapshot.readAdvisory(finding.advisoryDigest));
    } catch {
      // A snapshot that does not hold this record still explains the rest; the
      // change is reported by digest instead of by field.
    }
  }
  return byDigest;
}
