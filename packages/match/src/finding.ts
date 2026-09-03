import { canonicalBytes, compareBytes, compareCodeUnits, formatDigest } from '@dumpscan/canon';
import type { Digest, JsonObject } from '@dumpscan/canon';
import { leafHash, rootFromLeafHashes } from '@dumpscan/merkle';
import type { Ecosystem, OsvSeverity } from '@dumpscan/osv';

import type { RangeBounds } from './range.js';

/**
 * `affected` means the version falls in a range the advisory declares.
 * `excluded` means it did, and an exclusions file says otherwise.
 * `withdrawn-suppressed` means it did, and the advisory has been withdrawn.
 * `unevaluated` means dumpscan could not decide, and says why.
 */
export type FindingStatus = 'affected' | 'excluded' | 'withdrawn-suppressed' | 'unevaluated';

export interface MatchedRange extends RangeBounds {
  /** `SEMVER`, `ECOSYSTEM`, or `VERSIONS` for a match against an explicit list. */
  readonly type: string;
}

export interface Finding {
  readonly ecosystem: Ecosystem;
  readonly name: string;
  readonly version: string;
  readonly purl: string;
  readonly advisoryId: string;
  /** The advisory's `modified` value as of the snapshot. */
  readonly advisoryModified: string;
  /** Digest of the advisory's canonical record, which is its leaf in the feed. */
  readonly advisoryDigest: Digest;
  readonly matchedRange: MatchedRange | null;
  readonly aliases: readonly string[];
  readonly severity: readonly OsvSeverity[];
  readonly status: FindingStatus;
  /** Why the status is not `affected`, or null when it is. */
  readonly reason: string | null;
}

/**
 * Renders a finding as the JSON object that gets canonicalized and hashed. This
 * is the whole finding: nothing is dropped, so a change to any field moves the
 * findings root.
 *
 * @param finding - The finding.
 * @returns A plain JSON object.
 */
export function findingToJson(finding: Finding): JsonObject {
  return {
    ecosystem: finding.ecosystem,
    name: finding.name,
    version: finding.version,
    purl: finding.purl,
    advisoryId: finding.advisoryId,
    advisoryModified: finding.advisoryModified,
    advisoryDigest: finding.advisoryDigest,
    matchedRange:
      finding.matchedRange === null
        ? null
        : {
            type: finding.matchedRange.type,
            introduced: finding.matchedRange.introduced,
            fixed: finding.matchedRange.fixed,
            lastAffected: finding.matchedRange.lastAffected,
            limit: finding.matchedRange.limit,
          },
    aliases: [...finding.aliases],
    severity: finding.severity.map((entry) => ({ type: entry.type, score: entry.score })),
    status: finding.status,
    reason: finding.reason,
  };
}

/**
 * Orders findings for the findings file. The order is total and depends only on
 * the finding, never on the order the matcher produced them in.
 *
 * @param a - Left finding.
 * @param b - Right finding.
 * @returns Negative when a sorts first, positive when b does, zero when equal.
 */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    compareCodeUnits(a.ecosystem, b.ecosystem) ||
    compareCodeUnits(a.name, b.name) ||
    compareCodeUnits(a.version, b.version) ||
    compareCodeUnits(a.advisoryId, b.advisoryId) ||
    compareCodeUnits(a.advisoryDigest, b.advisoryDigest)
  );
}

/**
 * Hashes a finding as an RFC 6962 leaf over its canonical bytes.
 *
 * @param finding - The finding.
 * @returns The leaf hash.
 */
export function findingLeafHash(finding: Finding): Uint8Array {
  return leafHash(canonicalBytes(findingToJson(finding)));
}

/**
 * Computes the findings Merkle root.
 *
 * The leaves are sorted by hash, exactly as the feed's ecosystem trees are, so
 * `prove` treats both trees the same way and the root does not depend on the
 * ordering rule used to write the findings file.
 *
 * @param findings - The findings, in any order.
 * @returns The findings root.
 */
export function findingsRoot(findings: readonly Finding[]): Digest {
  const leaves = findings.map(findingLeafHash).sort(compareBytes);
  return formatDigest(rootFromLeafHashes(leaves));
}

/**
 * Returns the leaf hashes of a findings set in tree order, which is what an
 * inclusion proof indexes into.
 *
 * @param findings - The findings, in any order.
 * @returns The sorted leaf hashes.
 */
export function findingLeaves(findings: readonly Finding[]): Uint8Array[] {
  return findings.map(findingLeafHash).sort(compareBytes);
}
