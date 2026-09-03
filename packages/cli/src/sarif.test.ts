import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSnapshot } from '@dumpscan/osv';
import type { Finding } from '@dumpscan/match';
import type { ScanPredicate } from '@dumpscan/predicate';
import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT_FINDINGS } from './exit.js';
import { run } from './index.js';
import { toSarif } from './sarif.js';

const RECORDS = new URL('../../../fixtures/osv/synthetic/records', import.meta.url).pathname;
const FIXTURE = new URL('../../../fixtures/bundles/synthetic-npm-pypi', import.meta.url).pathname;

const PREDICATE: ScanPredicate = {
  feedDigest: `sha256:${'a'.repeat(64)}`,
  snapshotManifestDigest: `sha256:${'b'.repeat(64)}`,
  matcherVersion: '1.0.0',
  comparatorRulesetDigest: `sha256:${'c'.repeat(64)}`,
  exclusionsDigest: null,
  findingsRoot: `sha256:${'d'.repeat(64)}`,
  findingsCount: 1,
  ecosystems: ['npm'],
};

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ecosystem: 'npm',
    name: 'widget',
    version: '1.0.0',
    purl: 'pkg:npm/widget@1.0.0',
    advisoryId: 'DUMPSCAN-NPM-0001',
    advisoryModified: '2025-01-14T09:00:00Z',
    advisoryDigest: `sha256:${'e'.repeat(64)}`,
    matchedRange: {
      type: 'SEMVER',
      introduced: '0',
      fixed: '2.0.0',
      lastAffected: null,
      limit: null,
    },
    aliases: ['CVE-2024-90001'],
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }],
    status: 'affected',
    reason: null,
    ...overrides,
  };
}

function runOf(log: Record<string, unknown>): Record<string, unknown> {
  const runs = log['runs'] as Record<string, unknown>[];
  return runs[0] as Record<string, unknown>;
}

describe('toSarif', () => {
  const base = {
    predicate: PREDICATE,
    inputDigest: `sha256:${'f'.repeat(64)}`,
    lockfile: 'package-lock.json',
  };

  it('renders an affected finding as an error a reviewer can act on', () => {
    const results = runOf(toSarif({ ...base, findings: [finding()] }))['results'] as Record<
      string,
      unknown
    >[];
    expect(results).toHaveLength(1);
    expect(results[0]?.['level']).toBe('error');
    expect(results[0]?.['ruleId']).toBe('DUMPSCAN-NPM-0001');
    expect((results[0]?.['message'] as { text: string }).text).toBe(
      'pkg:npm/widget@1.0.0 is affected by DUMPSCAN-NPM-0001. Matched SEMVER range introduced 0, fixed 2.0.0.',
    );
  });

  it('keeps suppressed and undecidable findings so the log covers the same set as the root', () => {
    const log = toSarif({
      ...base,
      findings: [
        finding({ status: 'excluded', reason: 'not reachable' }),
        finding({ advisoryId: 'DUMPSCAN-NPM-0002', status: 'withdrawn-suppressed' }),
        finding({ advisoryId: 'DUMPSCAN-NPM-0003', status: 'unevaluated', matchedRange: null }),
      ],
    });
    const results = runOf(log)['results'] as Record<string, unknown>[];
    expect(results.map((entry) => entry['level'])).toStrictEqual(['note', 'note', 'warning']);
    expect((results[0]?.['message'] as { text: string }).text).toMatch(/not reachable\.$/);
    expect((results[2]?.['message'] as { text: string }).text).toBe(
      'pkg:npm/widget@1.0.0 is unevaluated by DUMPSCAN-NPM-0003.',
    );
  });

  it('emits one rule per advisory even when several packages match it', () => {
    const log = toSarif({
      ...base,
      findings: [finding(), finding({ name: 'gadget', purl: 'pkg:npm/gadget@1.0.0' })],
    });
    const driver = (runOf(log)['tool'] as { driver: { rules: unknown[] } }).driver;
    expect(driver.rules).toHaveLength(1);
    expect((driver.rules[0] as { fullDescription: { text: string } }).fullDescription.text).toBe(
      'DUMPSCAN-NPM-0001 (CVE-2024-90001)',
    );
  });

  it('carries the pinned digests so a reviewer can find the bundle the log came from', () => {
    const properties = runOf(toSarif({ ...base, findings: [finding()] }))['properties'] as Record<
      string,
      unknown
    >;
    expect(properties).toStrictEqual({
      feedDigest: PREDICATE.feedDigest,
      findingsRoot: PREDICATE.findingsRoot,
      comparatorRulesetDigest: PREDICATE.comparatorRulesetDigest,
      exclusionsDigest: null,
      inputDigest: base.inputDigest,
    });
  });
});

describe('dumpscan scan --sarif', () => {
  let work = '';
  let snapshotDir = '';

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'dumpscan-sarif-'));
    snapshotDir = join(work, 'snapshot');
    buildSnapshot(RECORDS, snapshotDir);
  });

  it('writes a SARIF log holding every finding the bundle holds', async () => {
    const sarifPath = join(work, 'dumpscan.sarif');
    const lines: string[] = [];
    const code = await run(
      [
        'scan',
        join(FIXTURE, 'package-lock.json'),
        '--snapshot',
        snapshotDir,
        '--out',
        join(work, 'scan.bundle.json'),
        '--sarif',
        sarifPath,
      ],
      (line) => lines.push(line),
      () => undefined,
    );
    expect(code).toBe(EXIT_FINDINGS);
    expect(lines.join('\n')).toContain(`sarif         ${sarifPath}`);

    const log = JSON.parse(readFileSync(sarifPath, 'utf8')) as Record<string, unknown>;
    expect(log['version']).toBe('2.1.0');
    const results = runOf(log)['results'] as Record<string, unknown>[];
    expect(results).toHaveLength(5);
    expect(results.filter((entry) => entry['level'] === 'error')).toHaveLength(3);
  });
});
