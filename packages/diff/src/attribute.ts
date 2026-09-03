import { canonicalJson, compareCodeUnits } from '@dumpscan/canon';
import type { Digest, JsonObject } from '@dumpscan/canon';
import type { InputManifest, InputPackage } from '@dumpscan/lockfiles';
import { findingToJson } from '@dumpscan/match';
import type { Finding } from '@dumpscan/match';
import type { OsvAdvisory } from '@dumpscan/osv';
import type { ScanPredicate } from '@dumpscan/predicate';

import { diffJson } from './record-diff.js';

/** Which of the four pinned inputs a change is attributed to. */
export type Cause = 'input' | 'feed' | 'comparator' | 'exclusions' | 'unexplained';

export interface DigestChange {
  readonly moved: boolean;
  readonly before: string | null;
  readonly after: string | null;
}

export interface FindingChange {
  readonly kind: 'added' | 'removed' | 'changed';
  /** Ecosystem, name, version, and advisory id, which identify a finding. */
  readonly key: string;
  readonly before: JsonObject | null;
  readonly after: JsonObject | null;
  readonly cause: Cause;
  readonly evidence: JsonObject;
}

export interface DiffInput {
  readonly predicate: ScanPredicate;
  readonly manifest: InputManifest;
  readonly findings: readonly Finding[];
  /** Advisory records by digest, when the snapshot is available. */
  readonly advisories?: ReadonlyMap<Digest, OsvAdvisory>;
}

export interface DiffResult {
  readonly digests: {
    readonly input: DigestChange;
    readonly feed: DigestChange;
    readonly comparator: DigestChange;
    readonly exclusions: DigestChange;
  };
  readonly changes: readonly FindingChange[];
  readonly unexplained: number;
}

/**
 * Attributes every changed finding between two scans to exactly one of the four
 * pinned inputs.
 *
 * The digests are compared first, because a cause that did not move cannot
 * explain anything. Then each change is tested against the causes in the order
 * that gives the most specific answer: a package that appeared or disappeared is
 * the input, a finding that started or stopped being excluded is the exclusions
 * file, an advisory whose record bytes moved is the feed, and a finding that
 * changed with none of those moving but the comparator ruleset moving is the
 * comparator.
 *
 * A change nothing explains is `unexplained`, which is a bug in dumpscan rather
 * than a fact about the two scans, and the CLI exits 3 on it.
 *
 * @param before - The earlier scan.
 * @param after - The later scan.
 * @returns The digest comparison, every change with its cause, and how many
 * changes went unexplained.
 */
export function diffScans(before: DiffInput, after: DiffInput): DiffResult {
  const digests = {
    input: digestChange(inputKeyOf(before), inputKeyOf(after)),
    feed: digestChange(before.predicate.feedDigest, after.predicate.feedDigest),
    comparator: digestChange(
      before.predicate.comparatorRulesetDigest,
      after.predicate.comparatorRulesetDigest,
    ),
    exclusions: digestChange(before.predicate.exclusionsDigest, after.predicate.exclusionsDigest),
  };

  const beforeByKey = index(before.findings);
  const afterByKey = index(after.findings);
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort(compareCodeUnits);

  const changes: FindingChange[] = [];
  for (const key of keys) {
    const left = beforeByKey.get(key);
    const right = afterByKey.get(key);
    if (left !== undefined && right !== undefined) {
      if (canonicalJson(findingToJson(left)) === canonicalJson(findingToJson(right))) continue;
    }

    const kind: FindingChange['kind'] =
      left === undefined ? 'added' : right === undefined ? 'removed' : 'changed';
    const attributed = attribute(left ?? null, right ?? null, before, after, digests);

    changes.push({
      kind,
      key,
      before: left === undefined ? null : findingToJson(left),
      after: right === undefined ? null : findingToJson(right),
      cause: attributed.cause,
      evidence: attributed.evidence,
    });
  }

  return {
    digests,
    changes,
    unexplained: changes.filter((change) => change.cause === 'unexplained').length,
  };
}

function attribute(
  left: Finding | null,
  right: Finding | null,
  before: DiffInput,
  after: DiffInput,
  digests: DiffResult['digests'],
): { cause: Cause; evidence: JsonObject } {
  const finding = left ?? right;
  if (finding === null) return { cause: 'unexplained', evidence: {} };

  if (digests.input.moved) {
    const inBefore = hasPackage(before.manifest, finding);
    const inAfter = hasPackage(after.manifest, finding);
    if (inBefore !== inAfter) {
      return {
        cause: 'input',
        evidence: {
          package: `${finding.ecosystem} ${finding.name}`,
          version: finding.version,
          inBefore,
          inAfter,
          versionsBefore: versionsOf(before.manifest, finding),
          versionsAfter: versionsOf(after.manifest, finding),
        },
      };
    }
  }

  if (digests.exclusions.moved && left !== null && right !== null) {
    if ((left.status === 'excluded') !== (right.status === 'excluded')) {
      return {
        cause: 'exclusions',
        evidence: {
          statusBefore: left.status,
          statusAfter: right.status,
          reasonBefore: left.reason,
          reasonAfter: right.reason,
        },
      };
    }
  }

  if (digests.feed.moved) {
    const feedEvidence = feedChange(left, right, before, after);
    if (feedEvidence !== null) return { cause: 'feed', evidence: feedEvidence };
  }

  if (digests.comparator.moved && left !== null && right !== null) {
    return {
      cause: 'comparator',
      evidence: {
        version: finding.version,
        rangeBefore: findingToJson(left)['matchedRange'] ?? null,
        rangeAfter: findingToJson(right)['matchedRange'] ?? null,
        note: 'the comparator ruleset moved and nothing else did; re-run this comparison under both dumpscan versions to see which bound flipped',
      },
    };
  }

  return { cause: 'unexplained', evidence: { key: `${finding.ecosystem} ${finding.name}` } };
}

function feedChange(
  left: Finding | null,
  right: Finding | null,
  before: DiffInput,
  after: DiffInput,
): JsonObject | null {
  if (left === null || right === null) {
    const finding = (left ?? right) as Finding;
    return {
      advisoryId: finding.advisoryId,
      presentBefore: left !== null,
      presentAfter: right !== null,
      advisoryDigest: finding.advisoryDigest,
      advisoryModified: finding.advisoryModified,
    };
  }
  if (left.advisoryDigest === right.advisoryDigest) return null;

  const evidence: JsonObject = {
    advisoryId: left.advisoryId,
    advisoryDigestBefore: left.advisoryDigest,
    advisoryDigestAfter: right.advisoryDigest,
    advisoryModifiedBefore: left.advisoryModified,
    advisoryModifiedAfter: right.advisoryModified,
  };

  const beforeRecord = before.advisories?.get(left.advisoryDigest);
  const afterRecord = after.advisories?.get(right.advisoryDigest);
  if (beforeRecord !== undefined && afterRecord !== undefined) {
    return {
      ...evidence,
      recordDiff: diffJson(beforeRecord.document, afterRecord.document).map((change) => ({
        path: change.path,
        before: change.before,
        after: change.after,
      })),
    };
  }
  return evidence;
}

function index(findings: readonly Finding[]): Map<string, Finding> {
  return new Map(findings.map((finding) => [keyOf(finding), finding]));
}

/**
 * The identity of a finding: which package version, and which advisory.
 *
 * @param finding - The finding.
 * @returns A stable key.
 */
export function keyOf(finding: Finding): string {
  return `${finding.ecosystem} ${finding.name} ${finding.version} ${finding.advisoryId}`;
}

function hasPackage(manifest: InputManifest, finding: Finding): boolean {
  return manifest.packages.some(
    (pkg) =>
      pkg.ecosystem === finding.ecosystem &&
      pkg.name === finding.name &&
      pkg.version === finding.version,
  );
}

function versionsOf(manifest: InputManifest, finding: Finding): string[] {
  return manifest.packages
    .filter((pkg: InputPackage) => pkg.ecosystem === finding.ecosystem && pkg.name === finding.name)
    .map((pkg) => pkg.version)
    .sort(compareCodeUnits);
}

function inputKeyOf(scan: DiffInput): string {
  return canonicalJson(
    scan.manifest.packages.map((pkg) => `${pkg.ecosystem} ${pkg.name} ${pkg.version}`),
  );
}

function digestChange(before: string | null, after: string | null): DigestChange {
  return { moved: before !== after, before, after };
}
