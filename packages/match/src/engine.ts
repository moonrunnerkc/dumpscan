import { compareCodeUnits } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import type { InputManifest } from '@dumpscan/lockfiles';
import { normalizePackageName } from '@dumpscan/osv';
import type { AdvisorySource, Ecosystem } from '@dumpscan/osv';

import { matchAdvisory } from './advisory-match.js';
import { compareFindings, findingsRoot } from './finding.js';
import type { Finding } from './finding.js';

/**
 * Semver of the matching engine, carried in the predicate as `matcherVersion`.
 * Bump it whenever matching semantics change, even when no public API does.
 * `scripts/check-conventions.mjs` fails if it drifts from the package version.
 */
export const MATCHER_VERSION = '0.1.0';

export interface MatchResult {
  readonly matcherVersion: string;
  readonly findings: readonly Finding[];
  readonly findingsRoot: Digest;
  /** Ecosystems the manifest actually asked about, sorted. */
  readonly ecosystems: readonly Ecosystem[];
}

/**
 * Matches an input manifest against a snapshot.
 *
 * Pure: no clock, no filesystem, no network, no environment. The advisory
 * source is an interface, so whether the snapshot is a directory, an archive, or
 * an array in a test is not something the engine can observe.
 *
 * Packages the parser could not resolve to a registry version do not produce
 * findings. They are already recorded in the input manifest, so they move the
 * input digest and `diff` attributes them there.
 *
 * @param manifest - The parsed lockfile.
 * @param source - The snapshot index to look advisories up in.
 * @returns The sorted findings and their Merkle root.
 */
export function matchManifest(manifest: InputManifest, source: AdvisorySource): MatchResult {
  const byKey = new Map<string, Finding>();
  const ecosystems = new Set<Ecosystem>();

  for (const pkg of manifest.packages) {
    ecosystems.add(pkg.ecosystem);
    const normalized = normalizePackageName(pkg.ecosystem, pkg.name);
    for (const advisory of source.advisoriesFor(pkg.ecosystem, normalized)) {
      const finding = matchAdvisory(advisory, pkg);
      if (finding === null) continue;
      // One advisory says one thing about one installed version. An index that
      // lists the same record twice must not double the findings set.
      const key = `${pkg.ecosystem} ${pkg.name} ${pkg.version} ${finding.advisoryId}`;
      if (!byKey.has(key)) byKey.set(key, finding);
    }
  }

  const findings = [...byKey.values()].sort(compareFindings);
  return {
    matcherVersion: MATCHER_VERSION,
    findings,
    findingsRoot: findingsRoot(findings),
    ecosystems: [...ecosystems].sort(compareCodeUnits),
  };
}
