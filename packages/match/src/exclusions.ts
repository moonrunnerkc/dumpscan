import {
  canonicalBytes,
  compareCodeUnits,
  digest,
  isJsonArray,
  isJsonObject,
} from '@dumpscan/canon';
import type { Digest, JsonObject, JsonValue } from '@dumpscan/canon';

/** Version tag over the shape of a dumpscan exclusions file. */
export const EXCLUSIONS_VERSION = 'dumpscan.exclusions/v1';

/** The OpenVEX status that means "we looked and it does not apply here". */
const NOT_AFFECTED = 'not_affected';

export interface Exclusion {
  /** Advisory id or alias the exclusion applies to. */
  readonly advisoryId: string;
  /** purl the exclusion is scoped to, or null for every package. */
  readonly purl: string | null;
  readonly justification: string;
  /** RFC 3339 instant after which the exclusion no longer applies, or null. */
  readonly expires: string | null;
}

export interface Exclusions {
  readonly source: 'dumpscan' | 'openvex';
  readonly exclusions: readonly Exclusion[];
  /** Digest of the canonical exclusions document, which the predicate carries. */
  readonly digest: Digest;
  /** True when at least one exclusion has an expiry, which is what puts evaluationTime in the predicate. */
  readonly hasExpiry: boolean;
}

/**
 * Parses a `dumpscan.exclusions.json` or an OpenVEX document.
 *
 * Both shapes reduce to the same list. OpenVEX statements are read only when
 * their status is `not_affected`: any other status is a claim about impact, not
 * a decision to stop reporting, and turning one into an exclusion would put
 * words in the author's mouth.
 *
 * @param value - The parsed JSON of the file.
 * @param origin - Where it came from, used in error messages.
 * @returns The exclusions, their digest, and whether any of them expire.
 * @throws Error when the document is neither shape, or an entry is malformed.
 */
export function parseExclusions(value: JsonValue, origin: string): Exclusions {
  if (!isJsonObject(value)) {
    throw new Error(
      `parseExclusions: ${origin} is not a JSON object; expected a dumpscan exclusions file or an OpenVEX document`,
    );
  }

  const { source, entries } = detectSource(value, origin);
  const exclusions =
    source === 'dumpscan' ? readDumpscan(entries, origin) : readOpenVex(entries, origin);
  const ordered = [...exclusions].sort(
    (a, b) =>
      compareCodeUnits(a.advisoryId, b.advisoryId) ||
      compareCodeUnits(a.purl ?? '', b.purl ?? '') ||
      compareCodeUnits(a.expires ?? '', b.expires ?? ''),
  );

  return {
    source,
    exclusions: ordered,
    digest: digest(canonicalBytes(exclusionsToJson(source, ordered))),
    hasExpiry: ordered.some((exclusion) => exclusion.expires !== null),
  };
}

/**
 * Renders exclusions in the canonical form whose digest the predicate carries.
 *
 * The digest is over the parsed exclusions, not the raw file, so reformatting a
 * VEX document does not look like a policy change while adding an entry does.
 *
 * @param source - Which shape the exclusions came from.
 * @param exclusions - The exclusions, already ordered.
 * @returns A plain JSON object.
 */
export function exclusionsToJson(
  source: 'dumpscan' | 'openvex',
  exclusions: readonly Exclusion[],
): JsonObject {
  return {
    exclusionsVersion: EXCLUSIONS_VERSION,
    source,
    exclusions: exclusions.map((exclusion) => ({
      advisoryId: exclusion.advisoryId,
      purl: exclusion.purl,
      justification: exclusion.justification,
      expires: exclusion.expires,
    })),
  };
}

/**
 * Decides which exclusions apply at an instant.
 *
 * An expired exclusion is treated as absent, which is the whole point of an
 * expiry: a suppression nobody renewed goes back to being a finding.
 *
 * @param exclusions - The parsed exclusions.
 * @param evaluationTime - RFC 3339 instant to compare expiries against.
 * @returns The exclusions still in force.
 */
export function activeExclusions(
  exclusions: readonly Exclusion[],
  evaluationTime: string,
): Exclusion[] {
  return exclusions.filter(
    (exclusion) =>
      exclusion.expires === null || compareInstants(evaluationTime, exclusion.expires) < 0,
  );
}

/**
 * Compares two RFC 3339 instants as strings, which is a correct ordering for
 * the Zulu form the exclusions schema requires. No clock and no Date are
 * involved, so `match` stays pure.
 *
 * @param a - Left instant.
 * @param b - Right instant.
 * @returns Negative when a is earlier, positive when b is, zero when equal.
 */
export function compareInstants(a: string, b: string): number {
  return compareCodeUnits(a, b);
}

function detectSource(
  value: JsonObject,
  origin: string,
): { source: 'dumpscan' | 'openvex'; entries: readonly JsonValue[] } {
  const exclusions = value['exclusions'];
  if (isJsonArray(exclusions)) return { source: 'dumpscan', entries: exclusions };
  const statements = value['statements'];
  if (isJsonArray(statements)) return { source: 'openvex', entries: statements };
  throw new Error(
    `parseExclusions: ${origin} has neither an exclusions array nor an OpenVEX statements array; dumpscan reads its own format and OpenVEX, and nothing else`,
  );
}

function readDumpscan(entries: readonly JsonValue[], origin: string): Exclusion[] {
  return entries.map((entry, index) => {
    const record = requireObject(entry, `${origin} exclusions[${index}]`);
    return {
      advisoryId: requireString(record['advisoryId'], `${origin} exclusions[${index}] advisoryId`),
      purl: optionalString(record['purl']),
      justification: requireString(
        record['justification'],
        `${origin} exclusions[${index}] justification`,
      ),
      expires: optionalInstant(record['expires'], `${origin} exclusions[${index}] expires`),
    };
  });
}

function readOpenVex(statements: readonly JsonValue[], origin: string): Exclusion[] {
  const out: Exclusion[] = [];

  statements.forEach((entry, index) => {
    const record = requireObject(entry, `${origin} statements[${index}]`);
    if (record['status'] !== NOT_AFFECTED) return;

    const vulnerability = record['vulnerability'];
    const advisoryId = isJsonObject(vulnerability)
      ? requireString(vulnerability['name'], `${origin} statements[${index}] vulnerability name`)
      : requireString(vulnerability, `${origin} statements[${index}] vulnerability`);

    const justification =
      optionalString(record['justification']) ??
      optionalString(record['impact_statement']) ??
      'not_affected';

    const products = isJsonArray(record['products']) ? record['products'] : [];
    const purls = products
      .map((product) =>
        isJsonObject(product) ? optionalString(product['@id']) : optionalString(product),
      )
      .filter((purl): purl is string => purl !== null);

    if (purls.length === 0) {
      out.push({ advisoryId, purl: null, justification, expires: null });
      return;
    }
    for (const purl of purls) out.push({ advisoryId, purl, justification, expires: null });
  });

  return out;
}

function requireObject(value: JsonValue, origin: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(`parseExclusions: ${origin} is not a JSON object`);
  }
  return value;
}

function requireString(value: JsonValue | undefined, origin: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`parseExclusions: ${origin} is missing or is not a non-empty string`);
  }
  return value;
}

function optionalString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function optionalInstant(value: JsonValue | undefined, origin: string): string | null {
  if (value === undefined || value === null) return null;
  const text = requireString(value, origin);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(text)) {
    throw new Error(
      `parseExclusions: ${origin} is ${JSON.stringify(text)}; an expiry has to be an RFC 3339 instant in Zulu form, such as 2026-12-31T00:00:00Z, so two machines compare it the same way`,
    );
  }
  return text;
}
