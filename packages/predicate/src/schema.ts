import type { JsonObject } from '@dumpscan/canon';

/** The in-toto Statement type dumpscan emits. */
export const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';

/** The predicate type. Bump the version on any change to the body shape. */
export const PREDICATE_TYPE = 'https://dumpscan.dev/scan/v1';

/** Where the published schema lives, and its `$id`. */
export const SCHEMA_ID = 'https://dumpscan.dev/schema/scan-v1.schema.json';

const DIGEST_PATTERN = '^sha256:[0-9a-f]{64}$';
const HEX_PATTERN = '^[0-9a-f]{64}$';

/**
 * The published JSON Schema for a dumpscan scan statement.
 *
 * This constant is the source of truth. `scripts/generate-schema.mjs` writes it
 * to `schema/scan-v1.schema.json` for publication and `pnpm lint` fails if the
 * two drift, so `predicate` can validate without reading the filesystem and the
 * published file cannot describe something the code does not produce.
 */
export const SCAN_STATEMENT_SCHEMA: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: SCHEMA_ID,
  title: 'dumpscan scan statement',
  description:
    'An in-toto Statement v1 binding a set of findings to the exact input, feed, matcher, and exclusions that produced them.',
  type: 'object',
  required: ['_type', 'subject', 'predicateType', 'predicate'],
  additionalProperties: false,
  properties: {
    _type: { const: STATEMENT_TYPE },
    predicateType: { const: PREDICATE_TYPE },
    subject: {
      type: 'array',
      minItems: 2,
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
            properties: { sha256: { type: 'string', pattern: HEX_PATTERN } },
          },
        },
      },
    },
    predicate: {
      type: 'object',
      required: [
        'feedDigest',
        'snapshotManifestDigest',
        'matcherVersion',
        'comparatorRulesetDigest',
        'exclusionsDigest',
        'findingsRoot',
        'findingsCount',
        'ecosystems',
      ],
      additionalProperties: false,
      properties: {
        feedDigest: { type: 'string', pattern: DIGEST_PATTERN },
        snapshotManifestDigest: { type: 'string', pattern: DIGEST_PATTERN },
        matcherVersion: {
          type: 'string',
          pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$',
        },
        comparatorRulesetDigest: { type: 'string', pattern: DIGEST_PATTERN },
        exclusionsDigest: {
          description: 'Digest of the applied exclusions or OpenVEX file, or null when none.',
          type: ['string', 'null'],
          pattern: DIGEST_PATTERN,
        },
        findingsRoot: { type: 'string', pattern: DIGEST_PATTERN },
        findingsCount: { type: 'integer', minimum: 0 },
        ecosystems: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', enum: ['Go', 'Maven', 'PyPI', 'crates.io', 'npm'] },
        },
        evaluationTime: {
          description:
            'The instant expiries were compared against. Present only when the exclusions file contains at least one expiry, and the only time dependent field in the body.',
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$',
        },
      },
    },
  },
};
