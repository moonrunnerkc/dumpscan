import { canonicalBytes, digest, isDigest, parseDigest, toHex } from '@dumpscan/canon';
import type { Digest, JsonObject, JsonValue } from '@dumpscan/canon';

import { PREDICATE_TYPE, SCAN_STATEMENT_SCHEMA, STATEMENT_TYPE } from './schema.js';
import { describeErrors, validate } from './validate.js';

/** Subject name dumpscan gives the canonical input manifest. */
export const INPUT_MANIFEST_SUBJECT = 'input-manifest';

export interface Subject {
  readonly name: string;
  /** The digest, keyed by algorithm as in-toto requires, with a bare hex value. */
  readonly digest: { readonly sha256: string };
}

export interface ScanPredicate {
  readonly feedDigest: Digest;
  readonly snapshotManifestDigest: Digest;
  readonly matcherVersion: string;
  readonly comparatorRulesetDigest: Digest;
  readonly exclusionsDigest: Digest | null;
  readonly findingsRoot: Digest;
  readonly findingsCount: number;
  readonly ecosystems: readonly string[];
  /**
   * The instant expiries were compared against. Present only when the exclusions
   * file contains an expiry, and the only time dependent field in the body.
   */
  readonly evaluationTime?: string;
}

export interface ScanStatement {
  readonly type: typeof STATEMENT_TYPE;
  readonly subject: readonly Subject[];
  readonly predicateType: typeof PREDICATE_TYPE;
  readonly predicate: ScanPredicate;
}

export interface BuildStatementInput {
  /** Digest of the canonical input manifest. */
  readonly inputDigest: Digest;
  /** Digest of the raw lockfile bytes. */
  readonly lockfileDigest: Digest;
  /** Name to record the lockfile subject under, usually its basename. */
  readonly lockfileName: string;
  readonly predicate: ScanPredicate;
}

/**
 * Builds the in-toto Statement v1 that gets signed.
 *
 * The subject is the canonical input manifest and the raw lockfile, both by
 * digest, so an attestation says which bytes were read as well as what the scan
 * concluded.
 *
 * @param input - The two subject digests and the predicate body.
 * @returns The statement.
 * @throws Error when the statement does not validate against the published
 * schema, which means the caller built a body dumpscan cannot sign.
 */
export function buildStatement(input: BuildStatementInput): ScanStatement {
  const statement: ScanStatement = {
    type: STATEMENT_TYPE,
    subject: [
      { name: INPUT_MANIFEST_SUBJECT, digest: { sha256: bareHex(input.inputDigest) } },
      { name: input.lockfileName, digest: { sha256: bareHex(input.lockfileDigest) } },
    ],
    predicateType: PREDICATE_TYPE,
    predicate: input.predicate,
  };
  assertValid(statementToJson(statement), 'buildStatement');
  return statement;
}

/**
 * Renders a statement as the JSON that gets canonicalized, hashed, and signed.
 *
 * `evaluationTime` is omitted rather than written as null when absent, because
 * the guide requires the field to exist only when an exclusions file carries an
 * expiry, and a present null would be a time dependent field by another name.
 *
 * @param statement - The statement.
 * @returns A plain JSON object.
 */
export function statementToJson(statement: ScanStatement): JsonObject {
  const predicate: JsonObject = {
    feedDigest: statement.predicate.feedDigest,
    snapshotManifestDigest: statement.predicate.snapshotManifestDigest,
    matcherVersion: statement.predicate.matcherVersion,
    comparatorRulesetDigest: statement.predicate.comparatorRulesetDigest,
    exclusionsDigest: statement.predicate.exclusionsDigest,
    findingsRoot: statement.predicate.findingsRoot,
    findingsCount: statement.predicate.findingsCount,
    ecosystems: [...statement.predicate.ecosystems],
    ...(statement.predicate.evaluationTime === undefined
      ? {}
      : { evaluationTime: statement.predicate.evaluationTime }),
  };

  return {
    _type: statement.type,
    subject: statement.subject.map((subject) => ({
      name: subject.name,
      digest: { sha256: subject.digest.sha256 },
    })),
    predicateType: statement.predicateType,
    predicate,
  };
}

/**
 * Computes the digest of a statement's canonical bytes.
 *
 * @param statement - The statement.
 * @returns The digest.
 */
export function statementDigest(statement: ScanStatement): Digest {
  return digest(canonicalBytes(statementToJson(statement)));
}

/**
 * Parses and validates a statement read back from a bundle.
 *
 * @param value - The parsed JSON of a statement.
 * @param origin - Where it came from, used in error messages.
 * @returns The statement.
 * @throws Error when it does not validate against the published schema.
 */
export function parseStatement(value: JsonValue, origin: string): ScanStatement {
  assertValid(value, origin);
  const document = value as unknown as {
    subject: Subject[];
    predicate: Record<string, JsonValue>;
  };

  const predicate = document.predicate;
  const evaluationTime = predicate['evaluationTime'];

  return {
    type: STATEMENT_TYPE,
    subject: document.subject.map((subject) => ({
      name: subject.name,
      digest: { sha256: subject.digest.sha256 },
    })),
    predicateType: PREDICATE_TYPE,
    predicate: {
      feedDigest: predicate['feedDigest'] as Digest,
      snapshotManifestDigest: predicate['snapshotManifestDigest'] as Digest,
      matcherVersion: predicate['matcherVersion'] as string,
      comparatorRulesetDigest: predicate['comparatorRulesetDigest'] as Digest,
      exclusionsDigest: predicate['exclusionsDigest'] as Digest | null,
      findingsRoot: predicate['findingsRoot'] as Digest,
      findingsCount: predicate['findingsCount'] as number,
      ecosystems: predicate['ecosystems'] as string[],
      ...(typeof evaluationTime === 'string' ? { evaluationTime } : {}),
    },
  };
}

/**
 * Finds a subject by name.
 *
 * @param statement - The statement to search.
 * @param name - The subject name.
 * @returns The subject's digest, or null when there is no such subject.
 */
export function subjectDigest(statement: ScanStatement, name: string): Digest | null {
  const subject = statement.subject.find((entry) => entry.name === name);
  if (subject === undefined) return null;
  return `sha256:${subject.digest.sha256}`;
}

function assertValid(value: JsonValue, origin: string): void {
  const errors = validate(SCAN_STATEMENT_SCHEMA, value);
  if (errors.length > 0) {
    throw new Error(
      `${origin}: the statement does not match ${SCAN_STATEMENT_SCHEMA['$id'] as string}: ${describeErrors(errors)}`,
    );
  }
}

function bareHex(value: Digest): string {
  if (!isDigest(value)) {
    throw new Error(
      `buildStatement: ${JSON.stringify(value)} is not a dumpscan digest; in-toto subjects carry bare hex, and dumpscan derives it from the sha256: form`,
    );
  }
  return toHex(parseDigest(value));
}
