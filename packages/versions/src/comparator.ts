import { canonicalBytes, compareCodeUnits, digest } from '@dumpscan/canon';
import type { Digest, JsonObject } from '@dumpscan/canon';
import type { Ecosystem } from '@dumpscan/osv';

import { ALL_CORPORA } from './corpus/all.js';
import type { VersionCorpus } from './corpus-types.js';
import { comparePep440, parsePep440 } from './pep440.js';
import { compareSemver, parseSemver } from './semver.js';

/** Version tag over the shape of the corpus document the ruleset digest hashes. */
export const RULESET_VERSION = 'dumpscan.comparators/v1';

/**
 * A total order over one ecosystem's version strings, plus the predicate that
 * says which strings it can order at all.
 */
export interface Comparator {
  readonly name: string;
  /** True when the comparator can order this string. */
  accepts(version: string): boolean;
  /** Orders two versions. Throws when either is not a version it accepts. */
  compare(a: string, b: string): number;
}

const SEMVER: Comparator = {
  name: 'semver',
  accepts: (version) => parseSemver(version) !== null,
  compare: compareSemver,
};

const PEP440: Comparator = {
  name: 'pep440',
  accepts: (version) => parsePep440(version) !== null,
  compare: comparePep440,
};

const BY_ECOSYSTEM: ReadonlyMap<Ecosystem, Comparator> = new Map([
  ['npm', SEMVER],
  ['PyPI', PEP440],
]);

const BY_NAME: ReadonlyMap<string, Comparator> = new Map(
  [SEMVER, PEP440].map((comparator) => [comparator.name, comparator]),
);

/**
 * Returns the comparator for an ecosystem.
 *
 * @param ecosystem - The ecosystem.
 * @returns Its comparator, or undefined when dumpscan has none yet.
 */
export function comparatorFor(ecosystem: Ecosystem): Comparator | undefined {
  return BY_ECOSYSTEM.get(ecosystem);
}

/**
 * Returns a comparator by name, as recorded in a corpus.
 *
 * @param name - The comparator name.
 * @returns The comparator, or undefined when no such comparator exists.
 */
export function comparatorByName(name: string): Comparator | undefined {
  return BY_NAME.get(name);
}

/**
 * The corpora that define what every comparator means, ordered by ecosystem.
 *
 * @returns The corpus document.
 */
export function corpusDocument(): JsonObject {
  const corpora = [...ALL_CORPORA].sort((a, b) => compareCodeUnits(a.ecosystem, b.ecosystem));
  return {
    rulesetVersion: RULESET_VERSION,
    corpora: corpora.map((corpus) => ({
      ecosystem: corpus.ecosystem,
      comparator: corpus.comparator,
      reference: corpus.reference,
      ordered: [...corpus.ordered],
      equal: corpus.equal.map((pair) => [...pair]),
      invalid: [...corpus.invalid],
    })),
  };
}

/**
 * The digest the scan predicate carries as `comparatorRulesetDigest`.
 *
 * It hashes the corpora rather than the comparator source, so a change that
 * alters ordering is detectable even when the package version does not move, and
 * a refactor that preserves ordering does not look like a semantics change.
 *
 * @returns The digest of the canonical corpus document.
 */
export function rulesetDigest(): Digest {
  return digest(canonicalBytes(corpusDocument()));
}

/**
 * All corpora, for the property and corpus tests and for `diff` to re-run a
 * comparison under a specific ruleset.
 *
 * @returns The corpora, ordered by ecosystem.
 */
export function corpora(): readonly VersionCorpus[] {
  return [...ALL_CORPORA].sort((a, b) => compareCodeUnits(a.ecosystem, b.ecosystem));
}
