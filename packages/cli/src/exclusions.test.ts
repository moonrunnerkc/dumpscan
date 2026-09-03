import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import { buildSnapshot } from '@dumpscan/osv';
import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT_FINDINGS, EXIT_USAGE } from './exit.js';
import { run } from './index.js';

const RECORDS = new URL('../../../fixtures/osv/synthetic/records', import.meta.url).pathname;
const NPM_FIXTURE = new URL('../../../fixtures/bundles/synthetic-npm-pypi', import.meta.url)
  .pathname;
const GO_FIXTURE = new URL('../../../fixtures/bundles/synthetic-cargo-go-maven', import.meta.url)
  .pathname;
const EXCLUSIONS = new URL('../../../fixtures/exclusions', import.meta.url).pathname;

let work = '';
let snapshotDir = '';
let bundlePath = '';

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(
    argv,
    (line) => out.push(line),
    (line) => err.push(line),
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'dumpscan-replay-cli-'));
  snapshotDir = join(work, 'snapshot');
  buildSnapshot(RECORDS, snapshotDir);
  bundlePath = join(work, 'scan.bundle.json');
  await cli(
    'scan',
    join(NPM_FIXTURE, 'package-lock.json'),
    '--snapshot',
    snapshotDir,
    '--out',
    bundlePath,
  );
});
describe('dumpscan scan with exclusions', () => {
  it('keeps an excluded finding in the set with status excluded', async () => {
    const out = join(work, 'excluded.bundle.json');
    const result = await cli(
      'scan',
      join(NPM_FIXTURE, 'package-lock.json'),
      '--snapshot',
      snapshotDir,
      '--exclusions',
      join(EXCLUSIONS, 'dumpscan.exclusions.json'),
      '--out',
      out,
      '--json',
    );
    const report = parseJson(result.out) as unknown as {
      statement: { predicate: { exclusionsDigest: string; evaluationTime?: string } };
      findings: { advisoryId: string; status: string; reason: string | null }[];
    };

    expect(report.findings).toHaveLength(5);
    const excluded = report.findings.find((finding) => finding.advisoryId === 'DUMPSCAN-NPM-0001');
    expect(excluded?.status).toBe('excluded');
    expect(excluded?.reason).toMatch(/excluded by DUMPSCAN-NPM-0001: the vulnerable code path/);
    expect(report.statement.predicate.exclusionsDigest).toMatch(/^sha256:/);
  });

  it('writes evaluationTime only when an exclusion can expire', async () => {
    const withExpiry = await cli(
      'scan',
      join(NPM_FIXTURE, 'package-lock.json'),
      '--snapshot',
      snapshotDir,
      '--exclusions',
      join(EXCLUSIONS, 'dumpscan.exclusions.json'),
      '--out',
      join(work, 'expiry.bundle.json'),
      '--json',
    );
    const withReport = parseJson(withExpiry.out) as unknown as {
      statement: { predicate: Record<string, unknown> };
    };
    expect(withReport.statement.predicate['evaluationTime']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );

    const withoutExpiry = await cli(
      'scan',
      join(NPM_FIXTURE, 'package-lock.json'),
      '--snapshot',
      snapshotDir,
      '--exclusions',
      join(EXCLUSIONS, 'openvex.json'),
      '--out',
      join(work, 'novex.bundle.json'),
      '--json',
    );
    const withoutReport = parseJson(withoutExpiry.out) as unknown as {
      statement: { predicate: Record<string, unknown> };
    };
    expect('evaluationTime' in withoutReport.statement.predicate).toBe(false);
  });

  it('treats an expired exclusion as absent', async () => {
    const result = await cli(
      'scan',
      join(NPM_FIXTURE, 'package-lock.json'),
      '--snapshot',
      snapshotDir,
      '--exclusions',
      join(EXCLUSIONS, 'expired.exclusions.json'),
      '--out',
      join(work, 'expired.bundle.json'),
      '--json',
    );
    const report = parseJson(result.out) as unknown as {
      findings: { advisoryId: string; status: string }[];
    };
    expect(report.findings.find((f) => f.advisoryId === 'DUMPSCAN-NPM-0001')?.status).toBe(
      'affected',
    );
  });

  it('excludes by alias as well as by advisory id', async () => {
    const result = await cli(
      'scan',
      join(NPM_FIXTURE, 'package-lock.json'),
      '--snapshot',
      snapshotDir,
      '--exclusions',
      join(EXCLUSIONS, 'dumpscan.exclusions.json'),
      '--out',
      join(work, 'alias.bundle.json'),
      '--json',
    );
    const report = parseJson(result.out) as unknown as {
      findings: { advisoryId: string; status: string }[];
    };
    // CVE-2025-90002 is an alias of DUMPSCAN-NPM-0002.
    expect(report.findings.find((f) => f.advisoryId === 'DUMPSCAN-NPM-0002')?.status).toBe(
      'excluded',
    );
  });

  it('applies an OpenVEX exclusion scoped to a purl', async () => {
    const result = await cli(
      'scan',
      join(NPM_FIXTURE, 'package-lock.json'),
      '--snapshot',
      snapshotDir,
      '--exclusions',
      join(EXCLUSIONS, 'openvex.json'),
      '--out',
      join(work, 'vex.bundle.json'),
      '--json',
    );
    const report = parseJson(result.out) as unknown as {
      findings: { advisoryId: string; purl: string; status: string }[];
    };
    expect(report.findings.find((f) => f.advisoryId === 'DUMPSCAN-MULTI-0001')?.status).toBe(
      'excluded',
    );
  });

  it('refuses an exclusions file that is not there', async () => {
    const result = await cli(
      'scan',
      join(NPM_FIXTURE, 'package-lock.json'),
      '--snapshot',
      snapshotDir,
      '--exclusions',
      join(work, 'nope.json'),
    );
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/does not exist/);
  });
});

describe('dumpscan scan on the remaining ecosystems', () => {
  it('scans Cargo, Go, and Gradle lockfiles', async () => {
    for (const lockfile of ['Cargo.lock', 'go.sum', 'gradle.lockfile']) {
      const out = join(work, `${lockfile}.bundle.json`);
      copyFileSync(join(GO_FIXTURE, lockfile), join(work, lockfile));
      const result = await cli(
        'scan',
        join(GO_FIXTURE, lockfile),
        '--snapshot',
        snapshotDir,
        '--out',
        out,
      );
      expect(result.code).toBe(EXIT_FINDINGS);
      expect(result.out).toContain('affected');
    }
  });

  it('marks a go.sum manifest as an upper bound', async () => {
    const out = join(work, 'go-bound.bundle.json');
    await cli('scan', join(GO_FIXTURE, 'go.sum'), '--snapshot', snapshotDir, '--out', out);
    const bundle = parseJson(readFileSync(out, 'utf8')) as unknown as {
      manifest: { overApproximated: boolean };
    };
    expect(bundle.manifest.overApproximated).toBe(true);
  });
});
