import { isJsonArray, isJsonObject } from '@dumpscan/canon';
import type { JsonObject, JsonValue } from '@dumpscan/canon';

import { baseEcosystem } from './ecosystem.js';

/** The OSV schema major version dumpscan understands. */
export const SUPPORTED_SCHEMA_MAJOR = 1;

/** OSV omits `schema_version` on older records, where it means 1.0.0. */
const DEFAULT_SCHEMA_VERSION = '1.0.0';

export type RangeType = 'SEMVER' | 'ECOSYSTEM' | 'GIT';

const RANGE_TYPES = new Set<string>(['SEMVER', 'ECOSYSTEM', 'GIT']);

/**
 * Reports whether a range type is one the OSV schema defines. Unknown types are
 * kept on the record and reported as unevaluated rather than guessed at.
 *
 * @param value - The `type` field of an OSV range.
 * @returns True for SEMVER, ECOSYSTEM, or GIT.
 */
export function isRangeType(value: string): value is RangeType {
  return RANGE_TYPES.has(value);
}

export interface OsvEvent {
  readonly introduced: string | null;
  readonly fixed: string | null;
  readonly lastAffected: string | null;
  readonly limit: string | null;
}

export interface OsvRange {
  readonly type: string;
  readonly events: readonly OsvEvent[];
}

export interface OsvSeverity {
  readonly type: string;
  readonly score: string;
}

export interface OsvAffected {
  readonly ecosystem: string;
  readonly name: string;
  readonly purl: string | null;
  readonly ranges: readonly OsvRange[];
  readonly versions: readonly string[];
  readonly severity: readonly OsvSeverity[];
}

/**
 * An OSV record parsed into the fields the matcher reads, alongside the whole
 * document. Everything hashes from `document`, never from the parsed view, so a
 * field dumpscan does not understand still moves the digest when it changes.
 */
export interface OsvAdvisory {
  readonly document: JsonObject;
  readonly id: string;
  readonly modified: string;
  readonly schemaVersion: string;
  readonly withdrawn: string | null;
  readonly aliases: readonly string[];
  readonly severity: readonly OsvSeverity[];
  readonly affected: readonly OsvAffected[];
}

/**
 * Parses an OSV document into the view the matcher uses.
 *
 * @param value - The parsed JSON of one OSV record.
 * @param origin - Where the record came from, used in error messages.
 * @returns The parsed advisory.
 * @throws Error when the document is not an OSV record, is missing `id` or
 * `modified`, or declares a schema major version dumpscan does not implement.
 */
export function parseAdvisory(value: JsonValue, origin: string): OsvAdvisory {
  if (!isJsonObject(value)) {
    throw new Error(
      `parseAdvisory: ${origin} is not a JSON object; an OSV record is a single object, not an array or a bare value`,
    );
  }

  const schemaVersion = optionalString(value, 'schema_version') ?? DEFAULT_SCHEMA_VERSION;
  const major = Number.parseInt(schemaVersion.split('.')[0] ?? '', 10);
  if (!Number.isInteger(major)) {
    throw new Error(
      `parseAdvisory: ${origin} declares schema_version ${JSON.stringify(schemaVersion)}, which is not a version number; dumpscan needs a major version to decide whether it can read the record`,
    );
  }
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    throw new Error(
      `parseAdvisory: ${origin} declares OSV schema major version ${major}, and dumpscan implements ${SUPPORTED_SCHEMA_MAJOR}; upgrade dumpscan or pin an older feed rather than building a snapshot that silently misreads records`,
    );
  }

  const id = requiredString(value, 'id', origin);
  const modified = requiredString(value, 'modified', origin);

  return {
    document: value,
    id,
    modified,
    schemaVersion,
    withdrawn: optionalString(value, 'withdrawn') ?? null,
    aliases: stringArray(value, 'aliases'),
    severity: parseSeverities(value['severity']),
    affected: parseAffected(value['affected']),
  };
}

/**
 * Lists the base ecosystems a record has at least one affected entry for.
 *
 * @param advisory - A parsed advisory.
 * @returns Distinct base ecosystem names, in first-seen order.
 */
export function advisoryEcosystems(advisory: OsvAdvisory): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const affected of advisory.affected) {
    const base = baseEcosystem(affected.ecosystem);
    if (base === '' || seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}

function parseAffected(value: JsonValue | undefined): OsvAffected[] {
  if (value === undefined || !isJsonArray(value)) return [];
  const out: OsvAffected[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) continue;
    const pkg = entry['package'];
    if (!isJsonObject(pkg)) continue;
    const ecosystem = optionalString(pkg, 'ecosystem');
    const name = optionalString(pkg, 'name');
    if (ecosystem === undefined || name === undefined) continue;
    out.push({
      ecosystem,
      name,
      purl: optionalString(pkg, 'purl') ?? null,
      ranges: parseRanges(entry['ranges']),
      versions: stringArray(entry, 'versions'),
      severity: parseSeverities(entry['severity']),
    });
  }
  return out;
}

function parseRanges(value: JsonValue | undefined): OsvRange[] {
  if (value === undefined || !isJsonArray(value)) return [];
  const out: OsvRange[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) continue;
    const type = optionalString(entry, 'type');
    if (type === undefined) continue;
    out.push({ type, events: parseEvents(entry['events']) });
  }
  return out;
}

function parseEvents(value: JsonValue | undefined): OsvEvent[] {
  if (value === undefined || !isJsonArray(value)) return [];
  const out: OsvEvent[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) continue;
    out.push({
      introduced: optionalString(entry, 'introduced') ?? null,
      fixed: optionalString(entry, 'fixed') ?? null,
      lastAffected: optionalString(entry, 'last_affected') ?? null,
      limit: optionalString(entry, 'limit') ?? null,
    });
  }
  return out;
}

function parseSeverities(value: JsonValue | undefined): OsvSeverity[] {
  if (value === undefined || !isJsonArray(value)) return [];
  const out: OsvSeverity[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) continue;
    const type = optionalString(entry, 'type');
    const score = optionalString(entry, 'score');
    if (type === undefined || score === undefined) continue;
    out.push({ type, score });
  }
  return out;
}

function stringArray(value: JsonObject, key: string): string[] {
  const member = value[key];
  if (member === undefined || !isJsonArray(member)) return [];
  return member.filter((item): item is string => typeof item === 'string');
}

function optionalString(value: JsonObject, key: string): string | undefined {
  const member = value[key];
  return typeof member === 'string' ? member : undefined;
}

function requiredString(value: JsonObject, key: string, origin: string): string {
  const member = optionalString(value, key);
  if (member === undefined || member === '') {
    throw new Error(
      `parseAdvisory: ${origin} has no ${key}; every OSV record needs one, so the file is either truncated or not an OSV record`,
    );
  }
  return member;
}
