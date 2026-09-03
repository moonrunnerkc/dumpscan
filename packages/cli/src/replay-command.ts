import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { inputDigest, parseLockfile } from '@dumpscan/lockfiles';
import type { InputManifest } from '@dumpscan/lockfiles';
import { findingToJson, matchManifest, parseExclusions } from '@dumpscan/match';
import type { Exclusions } from '@dumpscan/match';
import { manifestDigest, openSnapshot } from '@dumpscan/osv';
import { INPUT_MANIFEST_SUBJECT, subjectDigest } from '@dumpscan/predicate';
import { rulesetDigest } from '@dumpscan/versions';

import { flag } from './args.js';
import type { ParsedArgs } from './args.js';
import { readBundle } from './bundle-io.js';
import { EXIT_FINDINGS, EXIT_OK, UsageError } from './exit.js';
import type { CommandOutput } from './output.js';
import { resolveOptionsFrom } from './scan-command.js';
import { resolveSnapshotWithStores } from './snapshot-resolver.js';

interface Mismatch {
  readonly field: string;
  readonly recorded: string;
  readonly observed: string;
  readonly meaning: string;
}

/**
 * Runs `dumpscan replay`.
 *
 * Replay re-derives the findings from the pinned inputs and asserts the root the
 * bundle claims. Every check that can fail names which of the four digests moved,
 * because "the answer changed" is only useful with "and this is what changed".
 *
 * A comparator ruleset digest that differs is a hard stop unless `--explain` is
 * passed: the installed comparators order versions differently from the ones
 * that produced the bundle, so a matching root would be luck and a differing one
 * would be unattributable.
 *
 * @param args - Parsed arguments.
 * @returns Exit code, human lines, and a structured report.
 * @throws UsageError when the bundle path is missing or the snapshot cannot be
 * resolved.
 */
export async function runReplay(args: ParsedArgs): Promise<CommandOutput> {
  const bundlePath = args.positional[0];
  if (bundlePath === undefined) {
    throw new UsageError(
      'dumpscan replay needs a bundle path; run dumpscan replay <bundle> [--lockfile <path>] [--snapshot <digest|path>]',
    );
  }

  const bundle = readBundle(bundlePath);
  const recorded = bundle.statement.predicate;
  const mismatches: Mismatch[] = [];

  const installedRuleset = rulesetDigest();
  if (installedRuleset !== recorded.comparatorRulesetDigest) {
    const mismatch: Mismatch = {
      field: 'comparatorRulesetDigest',
      recorded: recorded.comparatorRulesetDigest,
      observed: installedRuleset,
      meaning:
        'the installed comparators order versions differently from the ones that produced this bundle',
    };
    if (!flag(args, 'explain')) {
      return report(
        bundlePath,
        [mismatch],
        [
          `refusing to replay: ${mismatch.meaning}.`,
          'Install the dumpscan that wrote the bundle, or pass --explain to replay anyway and see what moves.',
        ],
      );
    }
    mismatches.push(mismatch);
  }

  const snapshot = openSnapshot(
    await resolveSnapshotWithStores(
      args.options.get('snapshot') ?? recorded.feedDigest,
      resolveOptionsFrom(args),
    ),
  );
  if (snapshot.feedDigest !== recorded.feedDigest) {
    mismatches.push({
      field: 'feedDigest',
      recorded: recorded.feedDigest,
      observed: snapshot.feedDigest,
      meaning: 'the snapshot supplied is not the one this bundle was scanned against',
    });
  }
  const observedSnapshotManifest = manifestDigest(snapshot.manifest);
  if (observedSnapshotManifest !== recorded.snapshotManifestDigest) {
    mismatches.push({
      field: 'snapshotManifestDigest',
      recorded: recorded.snapshotManifestDigest,
      observed: observedSnapshotManifest,
      meaning:
        snapshot.feedDigest === recorded.feedDigest
          ? 'the snapshot holds the same records but was downloaded from a different source'
          : 'the manifest moved with the feed, which the feed digest already said',
    });
  }

  const manifest = reparse(args, bundle.manifest, bundlePath);
  const observedInput = inputDigest(manifest);
  const recordedInput = subjectDigest(bundle.statement, INPUT_MANIFEST_SUBJECT);
  if (observedInput !== recordedInput) {
    mismatches.push({
      field: 'inputDigest',
      recorded: recordedInput ?? 'none',
      observed: observedInput,
      meaning: 'the lockfile resolves a different package set than the one recorded',
    });
  }

  const exclusions = readExclusions(args);
  if ((exclusions?.digest ?? null) !== recorded.exclusionsDigest) {
    mismatches.push({
      field: 'exclusionsDigest',
      recorded: recorded.exclusionsDigest ?? 'none',
      observed: exclusions?.digest ?? 'none',
      meaning: 'a different set of exclusions was applied',
    });
  }

  const evaluationTime = recorded.evaluationTime;
  const result = matchManifest(manifest, snapshot, {
    ...(exclusions === undefined ? {} : { exclusions: exclusions.exclusions }),
    ...(evaluationTime === undefined ? {} : { evaluationTime }),
  });

  if (result.findingsRoot !== recorded.findingsRoot) {
    mismatches.push({
      field: 'findingsRoot',
      recorded: recorded.findingsRoot,
      observed: result.findingsRoot,
      meaning: 'the replayed findings are not the findings this bundle claims',
    });
  }

  const lines =
    mismatches.length === 0
      ? [
          `replayed      ${bundlePath}`,
          `input         ${observedInput}`,
          `feed          ${snapshot.feedDigest}`,
          `comparators   ${installedRuleset}`,
          `findings      ${String(result.findings.length)} reproduced`,
          `findingsRoot  ${result.findingsRoot} matches`,
        ]
      : mismatches.map(
          (mismatch) =>
            `${mismatch.field}: recorded ${mismatch.recorded}, observed ${mismatch.observed}; ${mismatch.meaning}`,
        );

  return report(
    bundlePath,
    mismatches,
    lines,
    result.findingsRoot,
    result.findings.map(findingToJson),
  );
}

function report(
  bundlePath: string,
  mismatches: readonly Mismatch[],
  lines: readonly string[],
  findingsRoot?: Digest,
  findings?: readonly unknown[],
): CommandOutput {
  return {
    exitCode: mismatches.length === 0 ? EXIT_OK : EXIT_FINDINGS,
    lines,
    json: {
      bundle: bundlePath,
      reproduced: mismatches.length === 0,
      mismatches,
      ...(findingsRoot === undefined ? {} : { findingsRoot }),
      ...(findings === undefined ? {} : { findings }),
    },
  };
}

function reparse(args: ParsedArgs, embedded: InputManifest, bundlePath: string): InputManifest {
  const lockfilePath = args.options.get('lockfile');
  if (lockfilePath === undefined || lockfilePath === '') return embedded;
  if (!existsSync(lockfilePath)) {
    throw new UsageError(`dumpscan replay: ${lockfilePath} does not exist`);
  }

  const sidecars = readSidecars(lockfilePath);
  const parsed = parseLockfile(lockfilePath, readFileSync(lockfilePath), sidecars);
  const manifest = parsed.manifests.find(
    (candidate) => candidate.workspaceRoot === embedded.workspaceRoot,
  );
  if (manifest === undefined) {
    throw new UsageError(
      `dumpscan replay: ${lockfilePath} has no workspace ${JSON.stringify(embedded.workspaceRoot)}, which ${bundlePath} was scanned from`,
    );
  }
  return manifest;
}

/** `go.sum` reads the `go.mod` beside it; every other format reads nothing else. */
function readSidecars(lockfilePath: string): Record<string, string> {
  const sidecar = join(dirname(lockfilePath), 'go.mod');
  if (!existsSync(sidecar)) return {};
  return { 'go.mod': readFileSync(sidecar, 'utf8') };
}

function readExclusions(args: ParsedArgs): Exclusions | undefined {
  const path = args.options.get('exclusions');
  if (path === undefined || path === '') return undefined;
  if (!existsSync(path)) {
    throw new UsageError(`dumpscan replay: ${path} does not exist`);
  }
  return parseExclusions(parseJson(readFileSync(path, 'utf8')), path);
}
