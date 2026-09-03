import { canonicalJson, digest, toHex } from '@dumpscan/canon';
import type { Digest, JsonObject } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import { PREDICATE_TYPE, SCAN_STATEMENT_SCHEMA, SCHEMA_ID, STATEMENT_TYPE } from './schema.js';
import {
  buildStatement,
  INPUT_MANIFEST_SUBJECT,
  parseStatement,
  statementDigest,
  statementToJson,
  subjectDigest,
} from './statement.js';
import type { ScanPredicate } from './statement.js';

const encoder = new TextEncoder();
const d = (text: string): Digest => digest(encoder.encode(text));

const PREDICATE: ScanPredicate = {
  feedDigest: d('feed'),
  snapshotManifestDigest: d('manifest'),
  matcherVersion: '0.1.0',
  comparatorRulesetDigest: d('ruleset'),
  exclusionsDigest: null,
  findingsRoot: d('findings'),
  findingsCount: 3,
  ecosystems: ['PyPI', 'npm'],
};

function build(predicate: Partial<ScanPredicate> = {}) {
  return buildStatement({
    inputDigest: d('input'),
    lockfileDigest: d('lockfile'),
    lockfileName: 'package-lock.json',
    predicate: { ...PREDICATE, ...predicate },
  });
}

describe('buildStatement', () => {
  it('names the in-toto and dumpscan types', () => {
    const statement = build();
    expect(statement.type).toBe(STATEMENT_TYPE);
    expect(statement.predicateType).toBe(PREDICATE_TYPE);
    expect(PREDICATE_TYPE).toBe('https://dumpscan.dev/scan/v1');
  });

  it('carries the input manifest and the raw lockfile as subjects, in bare hex', () => {
    const statement = build();
    expect(statement.subject).toStrictEqual([
      { name: INPUT_MANIFEST_SUBJECT, digest: { sha256: toHex(bytesOf(d('input'))) } },
      { name: 'package-lock.json', digest: { sha256: toHex(bytesOf(d('lockfile'))) } },
    ]);
  });

  it('refuses a digest that is not in the sha256 form', () => {
    expect(() =>
      buildStatement({
        inputDigest: 'nope' as Digest,
        lockfileDigest: d('lockfile'),
        lockfileName: 'package-lock.json',
        predicate: PREDICATE,
      }),
    ).toThrow(/is not a dumpscan digest/);
  });

  it('refuses a body the published schema does not allow', () => {
    expect(() => build({ findingsCount: -1 })).toThrow(/findingsCount/);
    expect(() => build({ matcherVersion: 'latest' })).toThrow(/matcherVersion/);
    expect(() => build({ ecosystems: ['Debian'] })).toThrow(/ecosystems/);
    expect(() => build({ feedDigest: 'sha256:zz' })).toThrow(
      /predicate\/feedDigest: "sha256:zz" does not match/,
    );
  });

  it('accepts an exclusions digest and a null one', () => {
    expect(build({ exclusionsDigest: d('exclusions') }).predicate.exclusionsDigest).toBe(
      d('exclusions'),
    );
    expect(build().predicate.exclusionsDigest).toBeNull();
  });

  it('accepts an evaluation time only in the Zulu form', () => {
    expect(build({ evaluationTime: '2026-09-03T00:00:00Z' }).predicate.evaluationTime).toBe(
      '2026-09-03T00:00:00Z',
    );
    expect(() => build({ evaluationTime: '2026-09-03 00:00:00 +0000' })).toThrow(/evaluationTime/);
  });
});

describe('statementToJson', () => {
  it('omits evaluationTime rather than writing it as null', () => {
    const json = statementToJson(build()) as unknown as { predicate: Record<string, unknown> };
    expect('evaluationTime' in json.predicate).toBe(false);
    const withTime = statementToJson(
      build({ evaluationTime: '2026-09-03T00:00:00Z' }),
    ) as unknown as { predicate: Record<string, unknown> };
    expect(withTime.predicate['evaluationTime']).toBe('2026-09-03T00:00:00Z');
  });

  it('renders exactly the body fields the guide names', () => {
    const json = statementToJson(build()) as unknown as { predicate: JsonObject };
    expect(Object.keys(json.predicate).sort((a, b) => (a < b ? -1 : 1))).toStrictEqual([
      'comparatorRulesetDigest',
      'ecosystems',
      'exclusionsDigest',
      'feedDigest',
      'findingsCount',
      'findingsRoot',
      'matcherVersion',
      'snapshotManifestDigest',
    ]);
  });

  it('canonicalizes with the in-toto key names', () => {
    expect(canonicalJson(statementToJson(build())).startsWith('{"_type":"')).toBe(true);
  });
});

describe('statementDigest', () => {
  it('is stable and moves with any body field', () => {
    expect(statementDigest(build())).toBe(statementDigest(build()));
    expect(statementDigest(build({ findingsCount: 4 }))).not.toBe(statementDigest(build()));
    expect(statementDigest(build({ ecosystems: ['npm'] }))).not.toBe(statementDigest(build()));
  });
});

describe('parseStatement', () => {
  it('round trips a statement through its JSON', () => {
    const original = build({ evaluationTime: '2026-09-03T00:00:00Z' });
    const parsed = parseStatement(statementToJson(original), 'test');
    expect(statementDigest(parsed)).toBe(statementDigest(original));
    expect(parsed.predicate.evaluationTime).toBe('2026-09-03T00:00:00Z');
  });

  it('leaves evaluationTime undefined when the body has none', () => {
    const parsed = parseStatement(statementToJson(build()), 'test');
    expect(parsed.predicate.evaluationTime).toBeUndefined();
  });

  it('refuses anything the schema rejects, naming the schema', () => {
    expect(() => parseStatement({ _type: 'nope' }, 'bundle.json')).toThrow(
      new RegExp(
        `bundle.json: the statement does not match ${SCHEMA_ID.replaceAll(/[./]/gu, '.')}`,
      ),
    );
    expect(() => parseStatement([], 'bundle.json')).toThrow(/expected object, found array/);
  });
});

describe('subjectDigest', () => {
  it('finds a subject by name and returns it in the sha256 form', () => {
    expect(subjectDigest(build(), INPUT_MANIFEST_SUBJECT)).toBe(d('input'));
    expect(subjectDigest(build(), 'package-lock.json')).toBe(d('lockfile'));
  });

  it('returns null for a subject that is not there', () => {
    expect(subjectDigest(build(), 'yarn.lock')).toBeNull();
  });
});

describe('SCAN_STATEMENT_SCHEMA', () => {
  it('publishes under the id it declares', () => {
    expect(SCAN_STATEMENT_SCHEMA['$id']).toBe(SCHEMA_ID);
    expect(SCAN_STATEMENT_SCHEMA['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
  });
});

function bytesOf(value: Digest): Uint8Array {
  const hex = value.slice('sha256:'.length);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
