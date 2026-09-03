import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import { buildSnapshot } from '@dumpscan/osv';
import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT_FINDINGS, EXIT_OK, EXIT_UNEXPLAINED, EXIT_USAGE } from './exit.js';
import { run } from './index.js';

const RECORDS = fileURLToPath(new URL('../../../fixtures/osv/synthetic/records', import.meta.url));
const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/bundles/synthetic-npm-pypi', import.meta.url),
);
const EXCLUSIONS = fileURLToPath(new URL('../../../fixtures/exclusions', import.meta.url));

interface Report {
  readonly digests: Record<string, { moved: boolean }>;
  readonly changes: {
    kind: string;
    cause: string;
    key: string;
    evidence: Record<string, unknown>;
  }[];
  readonly unexplained: number;
}

let work = '';
let snapshotDir = '';
let baseline = '';

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

async function scan(lockfile: string, out: string, ...extra: string[]): Promise<string> {
  await cli('scan', lockfile, '--snapshot', snapshotDir, '--out', out, ...extra);
  return out;
}

function report(text: string): Report {
  return parseJson(text) as unknown as Report;
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'dumpscan-diff-'));
  snapshotDir = join(work, 'snapshot');
  buildSnapshot(RECORDS, snapshotDir);
  baseline = await scan(join(FIXTURE, 'package-lock.json'), join(work, 'a.bundle.json'));
});

describe('dumpscan diff', () => {
  it('reports no change and exits 0 for two scans of the same thing', async () => {
    const same = await scan(join(FIXTURE, 'package-lock.json'), join(work, 'same.bundle.json'));
    const result = await cli('diff', baseline, same);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('no findings changed');
    expect(result.out).toMatch(/input {7}same/);
  });

  it('attributes an upgraded package to the input', async () => {
    const upgraded = join(work, 'upgraded');
    mkdirSync(upgraded, { recursive: true });
    const document = parseJson(
      readFileSync(join(FIXTURE, 'package-lock.json'), 'utf8'),
    ) as unknown as { packages: Record<string, { version?: string }> };
    (document.packages['node_modules/cheeseparser'] as { version: string }).version = '4.17.21';
    writeFileSync(join(upgraded, 'package-lock.json'), JSON.stringify(document, null, 2));

    const after = await scan(
      join(upgraded, 'package-lock.json'),
      join(work, 'upgraded.bundle.json'),
    );
    const result = await cli('diff', baseline, after, '--json');
    expect(result.code).toBe(EXIT_FINDINGS);

    const parsed = report(result.out);
    expect(parsed.digests['input']?.moved).toBe(true);
    expect(parsed.digests['feed']?.moved).toBe(false);
    expect(parsed.unexplained).toBe(0);
    expect(parsed.changes.every((change) => change.cause === 'input')).toBe(true);
    expect(parsed.changes.map((change) => change.key)).toContain(
      'npm cheeseparser 4.17.20 DUMPSCAN-NPM-0001',
    );
  });

  it('attributes a suppressed finding to the exclusions', async () => {
    const after = await scan(
      join(FIXTURE, 'package-lock.json'),
      join(work, 'excluded.bundle.json'),
      '--exclusions',
      join(EXCLUSIONS, 'dumpscan.exclusions.json'),
    );
    const result = await cli('diff', baseline, after, '--json');
    const parsed = report(result.out);

    expect(parsed.digests['exclusions']?.moved).toBe(true);
    expect(parsed.unexplained).toBe(0);
    expect(parsed.changes.every((change) => change.cause === 'exclusions')).toBe(true);
    expect(parsed.changes[0]?.evidence['statusAfter']).toBe('excluded');
  });

  it('attributes a rewritten advisory to the feed, with the record diff', async () => {
    const movedRecords = join(work, 'moved-records');
    mkdirSync(movedRecords, { recursive: true });
    for (const entry of ['DUMPSCAN-NPM-0001.json']) {
      const record = parseJson(readFileSync(join(RECORDS, entry), 'utf8')) as unknown as {
        modified: string;
        affected: { ranges: { events: { fixed?: string }[] }[] }[];
      };
      record.modified = '2026-01-01T00:00:00Z';
      const fixedEvent = record.affected[0]?.ranges[0]?.events[1] as { fixed: string };
      fixedEvent.fixed = '5.0.0';
      writeFileSync(join(movedRecords, entry), JSON.stringify(record, null, 2));
    }
    for (const entry of ['DUMPSCAN-NPM-0002.json', 'DUMPSCAN-MULTI-0001.json']) {
      writeFileSync(join(movedRecords, entry), readFileSync(join(RECORDS, entry), 'utf8'));
    }

    const movedSnapshot = join(work, 'moved-snapshot');
    buildSnapshot(movedRecords, movedSnapshot);
    const before = join(work, 'feed-before.bundle.json');
    const after = join(work, 'feed-after.bundle.json');
    const narrow = join(work, 'narrow-snapshot');
    buildSnapshot(join(RECORDS), narrow, { ecosystems: ['npm'] });

    await cli('scan', join(FIXTURE, 'package-lock.json'), '--snapshot', narrow, '--out', before);
    await cli(
      'scan',
      join(FIXTURE, 'package-lock.json'),
      '--snapshot',
      movedSnapshot,
      '--out',
      after,
    );

    const result = await cli(
      'diff',
      before,
      after,
      '--snapshot-a',
      narrow,
      '--snapshot-b',
      movedSnapshot,
      '--json',
    );
    const parsed = report(result.out);
    expect(parsed.digests['feed']?.moved).toBe(true);

    const feedChange = parsed.changes.find((change) => change.cause === 'feed');
    expect(feedChange).toBeDefined();
    const paths = (feedChange?.evidence['recordDiff'] as { path: string }[] | undefined)?.map(
      (entry) => entry.path,
    );
    expect(paths).toContain('/modified');
  });

  it('exits 3 and names the finding when nothing explains a change', async () => {
    const forged = join(work, 'forged.bundle.json');
    const document = parseJson(readFileSync(baseline, 'utf8')) as unknown as {
      findings: { advisoryId: string; status: string }[];
    };
    const finding = document.findings.find((entry) => entry.advisoryId === 'DUMPSCAN-NPM-0001') as {
      status: string;
    };
    finding.status = 'excluded';
    writeFileSync(forged, JSON.stringify(document));

    const result = await cli('diff', baseline, forged, '--json');
    expect(result.code).toBe(EXIT_UNEXPLAINED);
    const parsed = report(result.out);
    expect(parsed.unexplained).toBe(1);
    expect(parsed.changes[0]?.cause).toBe('unexplained');
    expect(parsed.changes[0]?.key).toBe('npm cheeseparser 4.17.20 DUMPSCAN-NPM-0001');
  });

  it('needs two bundle paths and a snapshot that exists', async () => {
    expect((await cli('diff')).code).toBe(EXIT_USAGE);
    expect((await cli('diff', baseline)).err).toMatch(/needs two bundle paths/);
    const missing = await cli('diff', baseline, baseline, '--snapshot-a', join(work, 'nope'));
    expect(missing.code).toBe(EXIT_USAGE);
    expect(missing.err).toMatch(/does not exist/);
  });
});
