import { digestOfJson } from '@dumpscan/canon';
import type { InputPackage } from '@dumpscan/lockfiles';
import { baseEcosystem } from '@dumpscan/osv';
import type { OsvAdvisory, OsvAffected } from '@dumpscan/osv';
import { comparatorFor, comparatorForRange } from '@dumpscan/versions';
import type { Comparator } from '@dumpscan/versions';

import type { Finding, FindingStatus, MatchedRange } from './finding.js';
import { evaluateRange, rangeVersions } from './range.js';

interface Outcome {
  readonly status: FindingStatus;
  readonly matchedRange: MatchedRange | null;
  readonly reason: string | null;
}

const STATUS_RANK: Readonly<Record<FindingStatus, number>> = {
  affected: 0,
  excluded: 1,
  'withdrawn-suppressed': 2,
  unevaluated: 3,
};

/**
 * Decides what one advisory says about one installed package.
 *
 * Every `affected` entry for the package is evaluated and the strongest outcome
 * wins: an affected range beats a withdrawal, which beats an undecidable range.
 * A range dumpscan cannot evaluate never silently becomes "not affected"; it
 * becomes an `unevaluated` finding that says why.
 *
 * @param advisory - The advisory from the snapshot.
 * @param pkg - The installed package tuple.
 * @returns The finding, or null when the advisory has nothing to say about this
 * version.
 */
export function matchAdvisory(advisory: OsvAdvisory, pkg: InputPackage): Finding | null {
  const entries = advisory.affected.filter(
    (affected) => baseEcosystem(affected.ecosystem) === pkg.ecosystem,
  );

  let best: Outcome | null = null;
  for (const entry of entries) {
    const outcome = evaluateAffected(entry, pkg);
    if (outcome === null) continue;
    if (best === null || STATUS_RANK[outcome.status] < STATUS_RANK[best.status]) best = outcome;
  }
  if (best === null) return null;

  let status: FindingStatus = best.status;
  let reason = best.reason;
  if (advisory.withdrawn !== null && best.status === 'affected') {
    status = 'withdrawn-suppressed';
    reason = `advisory was withdrawn at ${advisory.withdrawn}`;
  }

  return {
    ecosystem: pkg.ecosystem,
    name: pkg.name,
    version: pkg.version,
    purl: pkg.purl,
    advisoryId: advisory.id,
    advisoryModified: advisory.modified,
    advisoryDigest: digestOfJson(advisory.document),
    matchedRange: best.matchedRange,
    aliases: [...advisory.aliases],
    severity: entries.find((entry) => entry.severity.length > 0)?.severity ?? advisory.severity,
    status,
    reason,
  };
}

function evaluateAffected(entry: OsvAffected, pkg: InputPackage): Outcome | null {
  const ecosystemComparator = comparatorFor(pkg.ecosystem);
  const outcomes: Outcome[] = [];

  const listed = matchVersionList(entry, pkg, ecosystemComparator);
  if (listed !== null) outcomes.push(listed);

  for (const range of entry.ranges) {
    // versions decides which comparator reads a range, and answering undefined
    // is how it says dumpscan does not evaluate that range type at all. GIT is
    // the case that matters in v1.
    const comparator = comparatorForRange(pkg.ecosystem, range.type);
    if (comparator === undefined) {
      outcomes.push({
        status: 'unevaluated',
        matchedRange: null,
        reason: `dumpscan does not evaluate ${range.type} ranges, so this package may or may not be affected`,
      });
      continue;
    }

    const unreadable = [pkg.version, ...rangeVersions(range)].find(
      (version) => !comparator.accepts(version),
    );
    if (unreadable !== undefined) {
      outcomes.push({
        status: 'unevaluated',
        matchedRange: null,
        reason: `the ${comparator.name} comparator cannot read ${JSON.stringify(unreadable)}`,
      });
      continue;
    }

    const verdict = evaluateRange(comparator, range, pkg.version);
    if (verdict.affected) {
      outcomes.push({
        status: 'affected',
        matchedRange: { type: range.type, ...verdict.bounds },
        reason: null,
      });
    }
  }

  if (outcomes.length === 0) return null;
  return outcomes.reduce((a, b) => (STATUS_RANK[a.status] <= STATUS_RANK[b.status] ? a : b));
}

/**
 * Matches an explicit `versions` list. Two spellings of the same release, such
 * as `1.0` and `1.0.0` on PyPI, are the same version, so the comparator decides
 * when it can read both strings and an exact string match decides when it
 * cannot.
 */
function matchVersionList(
  entry: OsvAffected,
  pkg: InputPackage,
  comparator: Comparator | undefined,
): Outcome | null {
  for (const listed of entry.versions) {
    const equal =
      comparator !== undefined && comparator.accepts(listed) && comparator.accepts(pkg.version)
        ? comparator.compare(listed, pkg.version) === 0
        : listed === pkg.version;
    if (equal) {
      return {
        status: 'affected',
        matchedRange: {
          type: 'VERSIONS',
          introduced: listed,
          fixed: null,
          lastAffected: listed,
          limit: null,
        },
        reason: null,
      };
    }
  }
  return null;
}
