import { proveAdvisory, proveFinding, verifyProof } from '@dumpscan/sign';
import { openSnapshot } from '@dumpscan/osv';
import type { Digest } from '@dumpscan/canon';
import type { Ecosystem } from '@dumpscan/osv';
import { normalizePackageName } from '@dumpscan/osv';

import type { ParsedArgs } from './args.js';
import { readBundle } from './bundle-io.js';
import { EXIT_FINDINGS, EXIT_OK, UsageError } from './exit.js';
import type { CommandOutput } from './output.js';
import { resolveSnapshot } from './snapshot-resolver.js';

/**
 * Runs `dumpscan prove`.
 *
 * Emits the Merkle inclusion proof that a finding is in the findings set, and,
 * when a snapshot is available, that the advisory it names is in the feed. An
 * advisory that is not in the findings set comes back with the whole leaf list
 * instead of a path, because a set of hashes has no ordering a verifier could
 * use to bound a gap.
 *
 * @param args - Parsed arguments.
 * @returns Exit code, human lines, and the proofs.
 * @throws UsageError when the bundle or the advisory id is missing.
 */
export function runProve(args: ParsedArgs): CommandOutput {
  const bundlePath = args.positional[0];
  const advisoryId = args.positional[1];
  if (bundlePath === undefined || advisoryId === undefined) {
    throw new UsageError(
      'dumpscan prove needs a bundle and an advisory id; run dumpscan prove <bundle> <advisory-id> [--snapshot <digest|path>]',
    );
  }

  const bundle = readBundle(bundlePath);
  const finding = proveFinding(bundle.findings, advisoryId);
  const lines: string[] = [];
  let feed: unknown = null;

  if (finding.present) {
    const valid = verifyProof(finding.proof);
    lines.push(
      `finding   ${advisoryId} is leaf ${String(finding.proof.index)} of ${String(finding.proof.treeSize)} under ${finding.proof.root}`,
      `path      ${String(finding.proof.path.length)} hashes, ${valid ? 'verified' : 'DOES NOT VERIFY'}`,
      `package   ${finding.finding.purl} (${finding.finding.status})`,
    );
    feed = proveInFeed(
      args,
      finding.finding.ecosystem,
      finding.finding.name,
      finding.finding.advisoryDigest,
      lines,
    );
  } else {
    lines.push(
      `finding   ${advisoryId} is not in this findings set`,
      `root      ${finding.root} over ${String(finding.treeSize)} leaves, all listed in the JSON output`,
    );
  }

  return {
    exitCode: finding.present ? EXIT_OK : EXIT_FINDINGS,
    lines,
    json: { bundle: bundlePath, advisoryId, finding, feed },
  };
}

function proveInFeed(
  args: ParsedArgs,
  ecosystem: Ecosystem,
  name: string,
  advisoryDigest: Digest,
  lines: string[],
): unknown {
  const reference = args.options.get('snapshot');
  if (reference === undefined || reference === '') {
    lines.push('feed      no --snapshot given, so the advisory was not proved against the feed');
    return null;
  }

  const snapshot = openSnapshot(resolveSnapshot(reference, args.options.get('cache')));
  const digests = snapshot.digestsFor(ecosystem, normalizePackageName(ecosystem, name));
  const all = snapshot.manifest.ecosystems.find((entry) => entry.ecosystem === ecosystem);
  if (all === undefined || digests.length === 0) {
    lines.push(`feed      ${ecosystem} has no record for ${name} in this snapshot`);
    return null;
  }

  const proof = proveAdvisory(
    snapshot.manifest,
    ecosystem,
    snapshot.recordDigests(ecosystem),
    advisoryDigest,
  );
  lines.push(
    `advisory  record ${advisoryDigest} is leaf ${String(proof.proof.index)} of ${String(proof.proof.treeSize)} under ${proof.ecosystemRoot}`,
    `feed      ${proof.feedDigest}`,
  );
  return proof;
}
