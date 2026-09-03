import { compareBytes, formatDigest, fromHex, parseDigest, toHex } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { findingLeafHash, findingLeaves } from '@dumpscan/match';
import type { Finding } from '@dumpscan/match';
import { inclusionProof, leafHash, rootFromLeafHashes, verifyInclusion } from '@dumpscan/merkle';
import { ecosystemRoot, sortDigests } from '@dumpscan/osv';
import type { Ecosystem, SnapshotManifest } from '@dumpscan/osv';

export interface InclusionProof {
  readonly leaf: string;
  readonly index: number;
  readonly treeSize: number;
  readonly root: Digest;
  readonly path: readonly string[];
}

export type FindingProof =
  | { readonly present: true; readonly finding: Finding; readonly proof: InclusionProof }
  | {
      readonly present: false;
      readonly root: Digest;
      readonly treeSize: number;
      /** Every leaf in the tree, so a verifier can recompute the root and see the absence. */
      readonly leaves: readonly string[];
    };

/**
 * Proves that a finding is, or is not, in a findings set.
 *
 * The findings tree is a set of hashes with no ordering a verifier could use to
 * bound a gap, so absence cannot be proved with a path. Instead an absent
 * finding comes back with every leaf in the tree: a verifier recomputes the root
 * from them, sees it matches, and sees the leaf is not among them.
 *
 * @param findings - The findings the bundle carries.
 * @param advisoryId - The advisory to look for.
 * @returns A proof of inclusion, or the whole leaf set when it is absent.
 */
export function proveFinding(findings: readonly Finding[], advisoryId: string): FindingProof {
  const leaves = findingLeaves(findings);
  const root = rootOf(leaves);
  const finding = findings.find((candidate) => candidate.advisoryId === advisoryId);

  if (finding === undefined) {
    return { present: false, root, treeSize: leaves.length, leaves: leaves.map(toHex) };
  }

  const leaf = findingLeafHash(finding);
  const index = leaves.findIndex((candidate) => compareBytes(candidate, leaf) === 0);
  return {
    present: true,
    finding,
    proof: {
      leaf: toHex(leaf),
      index,
      treeSize: leaves.length,
      root,
      path: inclusionProof(leaves, index).map(toHex),
    },
  };
}

/**
 * Proves that an advisory record is in a feed snapshot.
 *
 * The proof has two levels because the feed digest does: the record's digest is
 * a leaf of its ecosystem's tree, and that ecosystem's entry is a leaf of the
 * top level tree. Both are returned so a verifier can walk from the record bytes
 * to the feed digest without holding the rest of the feed.
 *
 * @param manifest - The snapshot manifest, which carries the ecosystem roots.
 * @param ecosystem - The ecosystem the record belongs to.
 * @param recordDigests - Every record digest in that ecosystem.
 * @param recordDigest - The record to prove.
 * @returns The inclusion proof against the ecosystem root, plus that root and
 * the feed digest it rolls up into.
 * @throws Error when the ecosystem is not in the manifest or the record is not
 * in the ecosystem.
 */
export function proveAdvisory(
  manifest: SnapshotManifest,
  ecosystem: Ecosystem,
  recordDigests: readonly Digest[],
  recordDigest: Digest,
): { readonly proof: InclusionProof; readonly ecosystemRoot: Digest; readonly feedDigest: Digest } {
  const entry = manifest.ecosystems.find((candidate) => candidate.ecosystem === ecosystem);
  if (entry === undefined) {
    throw new Error(
      `proveAdvisory: the snapshot has no ${ecosystem} ecosystem; it covers ${manifest.ecosystems.map((e) => e.ecosystem).join(', ')}`,
    );
  }

  const ordered = sortDigests(recordDigests);
  const index = ordered.indexOf(recordDigest);
  if (index === -1) {
    throw new Error(
      `proveAdvisory: ${recordDigest} is not one of the ${ordered.length} ${ecosystem} records in this snapshot; the advisory is not in this feed`,
    );
  }

  const leaves = ordered.map((value) => leafHash(parseDigest(value)));
  const computed = ecosystemRoot(ordered);
  if (computed !== entry.root) {
    throw new Error(
      `proveAdvisory: the ${ecosystem} records hash to ${computed}, and the manifest claims ${entry.root}; the snapshot has been modified since it was written`,
    );
  }

  return {
    proof: {
      leaf: toHex(leaves[index] as Uint8Array),
      index,
      treeSize: leaves.length,
      root: entry.root,
      path: inclusionProof(leaves, index).map(toHex),
    },
    ecosystemRoot: entry.root,
    feedDigest: manifest.feedDigest,
  };
}

/**
 * Verifies an inclusion proof without the tree it came from.
 *
 * @param proof - The proof.
 * @returns True when the path recomputes the root.
 */
export function verifyProof(proof: InclusionProof): boolean {
  return verifyInclusion(
    parseDigest(proof.root),
    fromHex(proof.leaf),
    proof.index,
    proof.treeSize,
    proof.path.map(fromHex),
  );
}

function rootOf(leaves: readonly Uint8Array[]): Digest {
  return formatDigest(rootFromLeafHashes(leaves));
}
