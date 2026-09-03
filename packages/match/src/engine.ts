import { compareCodeUnits } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import type { InputManifest } from '@dumpscan/lockfiles';
import { normalizePackageName } from '@dumpscan/osv';
import type { AdvisorySource, Ecosystem } from '@dumpscan/osv';

import { matchAdvisory } from './advisory-match.js';
import { activeExclusions } from './exclusions.js';
import type { Exclusion } from './exclusions.js';
import { compareFindings, findingsRoot } from './finding.js';
import type { Finding } from './finding.js';

/**
 * Semver of the matching engine, carried in the predicate as `matcherVersion`.
 * Bump it whenever matching semantics change, even when no public API does.
 * `scripts/check-conventions.mjs` fails if it drifts from the package version.
 */
export const MATCHER_VERSION = '1.0.0';

export interface MatchOptions {
  /** Exclusions to apply. Expired ones are dropped before matching. */
  readonly exclusions?: readonly Exclusion[];
  /**
   * The instant expiries are compared against. Required when any exclusion has
   * one, and the only time dependent input the engine accepts. The caller reads
   * the clock; the engine never does.
   */
  readonly evaluationTime?: string;
}

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
 * An excluded finding keeps its place in the set with status `excluded`, never
 * dropped, so the findings root stays complete and "someone added an exclusion"
 * is something `diff` can attribute.
 *
 * @param manifest - The parsed lockfile.
 * @param source - The snapshot index to look advisories up in.
 * @param options - Exclusions and the instant their expiries are judged against.
 * @returns The sorted findings and their Merkle root.
 * @throws Error when an exclusion has an expiry and no evaluation time was given.
 */
export function matchManifest(
  manifest: InputManifest,
  source: AdvisorySource,
  options: MatchOptions = {},
): MatchResult {
  const exclusions = resolveExclusions(options);
  const byKey = new Map<string, Finding>();
  const ecosystems = new Set<Ecosystem>();

  for (const pkg of manifest.packages) {
    ecosystems.add(pkg.ecosystem);
    const normalized = normalizePackageName(pkg.ecosystem, pkg.name);
    for (const advisory of source.advisoriesFor(pkg.ecosystem, normalized)) {
      const matched = matchAdvisory(advisory, pkg);
      if (matched === null) continue;
      const finding = applyExclusions(matched, exclusions);
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

function resolveExclusions(options: MatchOptions): readonly Exclusion[] {
  const exclusions = options.exclusions ?? [];
  if (exclusions.length === 0) return [];
  if (!exclusions.some((exclusion) => exclusion.expires !== null)) return exclusions;

  if (options.evaluationTime === undefined) {
    throw new Error(
      'matchManifest: an exclusion has an expiry and no evaluationTime was given; the matcher never reads the clock, so the caller has to say which instant the expiry is judged against and record it in the predicate',
    );
  }
  return activeExclusions(exclusions, options.evaluationTime);
}

/**
 * Marks a finding excluded when an exclusion names its advisory. An exclusion
 * scoped to a purl applies only to that package; one with no purl applies to
 * every package the advisory matched.
 */
function applyExclusions(finding: Finding, exclusions: readonly Exclusion[]): Finding {
  if (finding.status !== 'affected') return finding;

  const ids = new Set([finding.advisoryId, ...finding.aliases]);
  const exclusion = exclusions.find(
    (candidate) =>
      ids.has(candidate.advisoryId) && (candidate.purl === null || candidate.purl === finding.purl),
  );
  if (exclusion === undefined) return finding;

  return {
    ...finding,
    status: 'excluded',
    reason: `excluded by ${exclusion.advisoryId}: ${exclusion.justification}`,
  };
}
