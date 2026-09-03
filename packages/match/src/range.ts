import type { OsvEvent, OsvRange } from '@dumpscan/osv';
import type { Comparator } from '@dumpscan/versions';

/** The `introduced` value OSV uses to mean "since the first release". */
export const FROM_THE_BEGINNING = '0';

export interface RangeBounds {
  /** The `introduced` event in effect at the version, or null when none is. */
  readonly introduced: string | null;
  /** The `fixed` event that ends the affected interval, or null when open. */
  readonly fixed: string | null;
  readonly lastAffected: string | null;
  readonly limit: string | null;
}

export interface RangeVerdict {
  readonly affected: boolean;
  readonly bounds: RangeBounds;
}

const NOT_AFFECTED: RangeVerdict = {
  affected: false,
  bounds: { introduced: null, fixed: null, lastAffected: null, limit: null },
};

/**
 * Evaluates one OSV range against a version.
 *
 * This is the event-list walk the OSV schema describes, not a semver range
 * match. Events are sorted by the ecosystem comparator with `introduced: "0"`
 * first and, at equal versions, `introduced` before the events that close an
 * interval. Then each event flips the affected flag: `introduced` at or below
 * the version turns it on, `fixed` or `limit` at or below turns it off, and
 * `last_affected` strictly below turns it off.
 *
 * @param comparator - The comparator for the range type.
 * @param range - The range to evaluate.
 * @param version - The exact installed version.
 * @returns Whether the version falls in the range, and the bounds in effect.
 * @throws Error when the comparator rejects a version string in the range.
 */
export function evaluateRange(
  comparator: Comparator,
  range: OsvRange,
  version: string,
): RangeVerdict {
  const events = sortEvents(comparator, range.events);

  // The bounds are bookkeeping for the report, not part of the decision: they
  // are only returned when the walk ends with the version affected, and every
  // `introduced` clears them because it opens a new interval.
  let affected = false;
  let introduced: string | null = null;
  let fixed: string | null = null;
  let lastAffected: string | null = null;
  let limit: string | null = null;

  for (const event of events) {
    if (event.introduced !== null) {
      if (
        event.introduced === FROM_THE_BEGINNING ||
        comparator.compare(version, event.introduced) >= 0
      ) {
        affected = true;
        introduced = event.introduced;
        fixed = null;
        lastAffected = null;
        limit = null;
      }
    } else if (event.fixed !== null) {
      if (comparator.compare(version, event.fixed) >= 0) affected = false;
      else fixed ??= event.fixed;
    } else if (event.lastAffected !== null) {
      if (comparator.compare(version, event.lastAffected) > 0) affected = false;
      else lastAffected ??= event.lastAffected;
    } else if (event.limit !== null) {
      if (comparator.compare(version, event.limit) >= 0) affected = false;
      else limit ??= event.limit;
    }
  }

  if (!affected) return NOT_AFFECTED;
  return { affected: true, bounds: { introduced, fixed, lastAffected, limit } };
}

/**
 * Orders the events of a range. OSV does not require them to be written in
 * order, and the walk only produces the right answer on a sorted list.
 *
 * @param comparator - The comparator for the range type.
 * @param events - Events as written in the record.
 * @returns The events ordered by version, with `introduced` first at ties.
 * @throws Error when the comparator rejects a version string.
 */
export function sortEvents(comparator: Comparator, events: readonly OsvEvent[]): OsvEvent[] {
  return [...events].sort((a, b) => {
    const left = eventVersion(a);
    const right = eventVersion(b);
    if (left === null || right === null) return eventRank(a) - eventRank(b);
    if (left === FROM_THE_BEGINNING && right === FROM_THE_BEGINNING) return 0;
    if (left === FROM_THE_BEGINNING) return -1;
    if (right === FROM_THE_BEGINNING) return 1;
    return comparator.compare(left, right) || eventRank(a) - eventRank(b);
  });
}

/**
 * Lists every version string an event refers to, so a caller can check whether
 * the comparator can read them before trying to evaluate the range.
 *
 * @param range - The range to inspect.
 * @returns The version strings, excluding the `0` sentinel.
 */
export function rangeVersions(range: OsvRange): string[] {
  const out: string[] = [];
  for (const event of range.events) {
    const version = eventVersion(event);
    if (version !== null && version !== FROM_THE_BEGINNING) out.push(version);
  }
  return out;
}

function eventVersion(event: OsvEvent): string | null {
  return event.introduced ?? event.fixed ?? event.lastAffected ?? event.limit;
}

function eventRank(event: OsvEvent): number {
  if (event.introduced !== null) return 0;
  if (event.fixed !== null) return 1;
  if (event.lastAffected !== null) return 2;
  if (event.limit !== null) return 3;
  return 4;
}
