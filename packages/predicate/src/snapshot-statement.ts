import { canonicalBytes, digest, isDigest, parseDigest, toHex } from '@dumpscan/canon';
import type { Digest, JsonObject, JsonValue } from '@dumpscan/canon';

import { STATEMENT_TYPE } from './schema.js';
import { describeErrors, validate } from './validate.js';

/** Predicate type for the attestation over a published feed snapshot. */
export const SNAPSHOT_PREDICATE_TYPE = 'https://dumpscan.dev/snapshot/v1';

/** Subject name the snapshot manifest is attested under. */
export const SNAPSHOT_MANIFEST_SUBJECT = 'snapshot-manifest';

/** `$id` of the published snapshot schema. */
export const SNAPSHOT_SCHEMA_ID = 'https://dumpscan.dev/schema/snapshot-v1.schema.json';

const DIGEST_PATTERN = '^sha256:[0-9a-f]{64}$';

export interface SnapshotSourceClaim {
  readonly ecosystem: string;
  readonly url: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly recordCount: number;
}

export interface SnapshotPredicate {
  readonly feedDigest: Digest;
  readonly recordCount: number;
  readonly sources: readonly SnapshotSourceClaim[];
}

export interface SnapshotStatement {
  readonly type: typeof STATEMENT_TYPE;
  readonly subject: readonly {
    readonly name: string;
    readonly digest: { readonly sha256: string };
  }[];
  readonly predicateType: typeof SNAPSHOT_PREDICATE_TYPE;
  readonly predicate: SnapshotPredicate;
}

/**
 * Schema for the snapshot attestation, published alongside the scan schema.
 *
 * A snapshot attestation says where each ecosystem's archive was fetched from
 * and what the server said about it at that moment. It carries no scan and no
 * findings: it is the claim that these bytes are the feed they say they are.
 */
export const SNAPSHOT_STATEMENT_SCHEMA: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: SNAPSHOT_SCHEMA_ID,
  title: 'dumpscan snapshot statement',
  description: 'An in-toto Statement v1 binding a feed snapshot to where its records came from.',
  type: 'object',
  required: ['_type', 'subject', 'predicateType', 'predicate'],
  additionalProperties: false,
  properties: {
    _type: { const: STATEMENT_TYPE },
    predicateType: { const: SNAPSHOT_PREDICATE_TYPE },
    subject: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'digest'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', pattern: '^\\S(?:.*\\S)?$' },
          digest: {
            type: 'object',
            required: ['sha256'],
            additionalProperties: false,
            properties: { sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
          },
        },
      },
    },
    predicate: {
      type: 'object',
      required: ['feedDigest', 'recordCount', 'sources'],
      additionalProperties: false,
      properties: {
        feedDigest: { type: 'string', pattern: DIGEST_PATTERN },
        recordCount: { type: 'integer', minimum: 0 },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            required: ['ecosystem', 'url', 'etag', 'lastModified', 'recordCount'],
            additionalProperties: false,
            properties: {
              ecosystem: { type: 'string' },
              url: { type: 'string' },
              etag: { type: ['string', 'null'] },
              lastModified: { type: ['string', 'null'] },
              recordCount: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  },
};

/**
 * Builds the statement that gets signed alongside a published snapshot.
 *
 * @param manifestDigest - Digest of the snapshot manifest, which is the subject.
 * @param predicate - The feed digest, record count, and per-ecosystem sources.
 * @returns The statement.
 * @throws Error when it does not validate against the published schema.
 */
export function buildSnapshotStatement(
  manifestDigest: Digest,
  predicate: SnapshotPredicate,
): SnapshotStatement {
  if (!isDigest(manifestDigest)) {
    throw new Error(
      `buildSnapshotStatement: ${JSON.stringify(manifestDigest)} is not a dumpscan digest`,
    );
  }
  const statement: SnapshotStatement = {
    type: STATEMENT_TYPE,
    subject: [
      { name: SNAPSHOT_MANIFEST_SUBJECT, digest: { sha256: toHex(parseDigest(manifestDigest)) } },
    ],
    predicateType: SNAPSHOT_PREDICATE_TYPE,
    predicate,
  };
  assertValid(snapshotStatementToJson(statement), 'buildSnapshotStatement');
  return statement;
}

/**
 * Renders a snapshot statement as the JSON that gets signed.
 *
 * @param statement - The statement.
 * @returns A plain JSON object.
 */
export function snapshotStatementToJson(statement: SnapshotStatement): JsonObject {
  return {
    _type: statement.type,
    subject: statement.subject.map((subject) => ({
      name: subject.name,
      digest: { sha256: subject.digest.sha256 },
    })),
    predicateType: statement.predicateType,
    predicate: {
      feedDigest: statement.predicate.feedDigest,
      recordCount: statement.predicate.recordCount,
      sources: statement.predicate.sources.map((source) => ({
        ecosystem: source.ecosystem,
        url: source.url,
        etag: source.etag,
        lastModified: source.lastModified,
        recordCount: source.recordCount,
      })),
    },
  };
}

/**
 * Parses and validates a snapshot statement read back from a store.
 *
 * @param value - The parsed JSON.
 * @param origin - Where it came from, used in error messages.
 * @returns The statement.
 * @throws Error when it does not validate against the published schema.
 */
export function parseSnapshotStatement(value: JsonValue, origin: string): SnapshotStatement {
  assertValid(value, origin);
  const document = value as unknown as {
    subject: { name: string; digest: { sha256: string } }[];
    predicate: SnapshotPredicate;
  };
  return {
    type: STATEMENT_TYPE,
    subject: document.subject.map((subject) => ({
      name: subject.name,
      digest: { sha256: subject.digest.sha256 },
    })),
    predicateType: SNAPSHOT_PREDICATE_TYPE,
    predicate: document.predicate,
  };
}

/**
 * Digest of a snapshot statement's canonical bytes.
 *
 * @param statement - The statement.
 * @returns The digest.
 */
export function snapshotStatementDigest(statement: SnapshotStatement): Digest {
  return digest(canonicalBytes(snapshotStatementToJson(statement)));
}

function assertValid(value: JsonValue, origin: string): void {
  const errors = validate(SNAPSHOT_STATEMENT_SCHEMA, value);
  if (errors.length > 0) {
    throw new Error(
      `${origin}: the statement does not match ${SNAPSHOT_SCHEMA_ID}: ${describeErrors(errors)}`,
    );
  }
}
