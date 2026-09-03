import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import { buildSnapshot } from '@dumpscan/osv';
import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE } from './exit.js';
import { run } from './index.js';

const RECORDS = fileURLToPath(new URL('../../../fixtures/osv/synthetic/records', import.meta.url));
const NPM_FIXTURE = fileURLToPath(
  new URL('../../../fixtures/bundles/synthetic-npm-pypi', import.meta.url),
);
const GO_FIXTURE = fileURLToPath(
  new URL('../../../fixtures/bundles/synthetic-cargo-go-maven', import.meta.url),
);
const EXCLUSIONS = fileURLToPath(new URL('../../../fixtures/exclusions', import.meta.url));

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

describe('dumpscan replay', () => {
  it('reproduces the findings root from the manifest embedded in the bundle', async () => {
    const result = await cli('replay', bundlePath, '--snapshot', snapshotDir);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('matches');
    expect(result.out).toContain('5 reproduced');
  });

  it('reproduces it again from the lockfile itself', async () => {
    const result = await cli(
      'replay',
      bundlePath,
      '--snapshot',
      snapshotDir,
      '--lockfile',
      join(NPM_FIXTURE, 'package-lock.json'),
    );
    expect(result.code).toBe(EXIT_OK);
  });

  it('reproduces a go.sum bundle, reading the go.mod beside it', async () => {
    const goBundle = join(work, 'go.bundle.json');
    await cli('scan', join(GO_FIXTURE, 'go.sum'), '--snapshot', snapshotDir, '--out', goBundle);
    const result = await cli(
      'replay',
      goBundle,
      '--snapshot',
      snapshotDir,
      '--lockfile',
      join(GO_FIXTURE, 'go.sum'),
    );
    expect(result.code).toBe(EXIT_OK);
  });

  it('names the input digest when the lockfile resolves a different package set', async () => {
    const changed = join(work, 'changed');
    mkdirSync(changed, { recursive: true });
    const document = parseJson(
      readFileSync(join(NPM_FIXTURE, 'package-lock.json'), 'utf8'),
    ) as unknown as { packages: Record<string, { version?: string }> };
    (document.packages['node_modules/cheeseparser'] as { version: string }).version = '4.17.21';
    writeFileSync(join(changed, 'package-lock.json'), JSON.stringify(document, null, 2));

    const result = await cli(
      'replay',
      bundlePath,
      '--snapshot',
      snapshotDir,
      '--lockfile',
      join(changed, 'package-lock.json'),
      '--json',
    );
    expect(result.code).toBe(EXIT_FINDINGS);
    const report = parseJson(result.out) as unknown as {
      reproduced: boolean;
      mismatches: { field: string; meaning: string }[];
    };
    expect(report.reproduced).toBe(false);
    expect(report.mismatches.map((mismatch) => mismatch.field)).toStrictEqual([
      'inputDigest',
      'findingsRoot',
    ]);
    expect(report.mismatches[0]?.meaning).toMatch(/resolves a different package set/);
  });

  it('names the feed digest when the snapshot is not the one that was scanned', async () => {
    const npmOnly = join(work, 'npm-only');
    buildSnapshot(RECORDS, npmOnly, { ecosystems: ['npm'] });
    const result = await cli('replay', bundlePath, '--snapshot', npmOnly, '--json');
    const report = parseJson(result.out) as unknown as { mismatches: { field: string }[] };
    expect(report.mismatches.map((mismatch) => mismatch.field)).toContain('feedDigest');
  });

  it('names the exclusions digest when a different set is applied', async () => {
    const result = await cli(
      'replay',
      bundlePath,
      '--snapshot',
      snapshotDir,
      '--exclusions',
      join(EXCLUSIONS, 'openvex.json'),
      '--json',
    );
    const report = parseJson(result.out) as unknown as { mismatches: { field: string }[] };
    expect(report.mismatches.map((mismatch) => mismatch.field)).toContain('exclusionsDigest');
  });

  it('refuses when the installed comparators order versions differently', async () => {
    const drifted = join(work, 'drifted.bundle.json');
    const document = parseJson(readFileSync(bundlePath, 'utf8')) as unknown as {
      statement: { predicate: { comparatorRulesetDigest: string } };
    };
    document.statement.predicate.comparatorRulesetDigest = `sha256:${'0'.repeat(64)}`;
    writeFileSync(drifted, JSON.stringify(document));

    const refused = await cli('replay', drifted, '--snapshot', snapshotDir);
    expect(refused.code).toBe(EXIT_FINDINGS);
    expect(refused.out).toMatch(/refusing to replay/);
    expect(refused.out).toMatch(/pass --explain/);

    const explained = await cli(
      'replay',
      drifted,
      '--snapshot',
      snapshotDir,
      '--explain',
      '--json',
    );
    const report = parseJson(explained.out) as unknown as { mismatches: { field: string }[] };
    expect(report.mismatches.map((mismatch) => mismatch.field)).toContain(
      'comparatorRulesetDigest',
    );
  });

  it('needs a bundle path, and refuses a lockfile that is not there', async () => {
    expect((await cli('replay')).code).toBe(EXIT_USAGE);
    expect((await cli('replay')).err).toMatch(/needs a bundle path/);
    const missing = await cli(
      'replay',
      bundlePath,
      '--snapshot',
      snapshotDir,
      '--lockfile',
      join(work, 'nope.json'),
    );
    expect(missing.code).toBe(EXIT_USAGE);
    expect(missing.err).toMatch(/does not exist/);
  });
});
