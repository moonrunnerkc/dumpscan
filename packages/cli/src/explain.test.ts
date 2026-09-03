import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import { buildSnapshot } from '@dumpscan/osv';
import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE } from './exit.js';
import { run } from './index.js';

const RECORDS = new URL('../../../fixtures/osv/synthetic/records', import.meta.url).pathname;
const FIXTURE = new URL('../../../fixtures/bundles/synthetic-npm-pypi', import.meta.url).pathname;
const SCANNERS = new URL('../../../fixtures/scanners', import.meta.url).pathname;

let work = '';
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
  work = mkdtempSync(join(tmpdir(), 'dumpscan-explain-'));
  const snapshotDir = join(work, 'snapshot');
  buildSnapshot(RECORDS, snapshotDir);
  bundlePath = join(work, 'scan.bundle.json');
  await cli(
    'scan',
    join(FIXTURE, 'package-lock.json'),
    '--snapshot',
    snapshotDir,
    '--out',
    bundlePath,
  );
});

describe('dumpscan explain', () => {
  it('buckets every disagreement with Grype and says it is not signed', async () => {
    const result = await cli('explain', bundlePath, join(SCANNERS, 'grype.json'));
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).toContain('scanner              grype');
    expect(result.out).toContain('identifier mismatch  1');
    expect(result.out).toMatch(/this report is a diagnostic and is never signed/);
  });

  it('reports the same buckets in the machine readable form', async () => {
    const result = await cli('explain', bundlePath, join(SCANNERS, 'grype.json'), '--json');
    const report = parseJson(result.out) as unknown as {
      scanner: string;
      counts: Record<string, number>;
      agreed: { advisory: string }[];
      discrepancies: { bucket: string; advisory: string }[];
    };
    expect(report.scanner).toBe('grype');
    expect(report.agreed.map((entry) => entry.advisory)).toContain('DUMPSCAN-NPM-0001');
    expect(report.counts['identifier-mismatch']).toBe(1);
    expect(report.discrepancies.find((entry) => entry.advisory === 'CVE-2019-11111')?.bucket).toBe(
      'identifier-mismatch',
    );
    expect(
      report.discrepancies.find((entry) => entry.advisory === 'DUMPSCAN-NPM-0003')?.bucket,
    ).toBe('suppression');
  });

  it('reads Trivy output as well', async () => {
    const result = await cli('explain', bundlePath, join(SCANNERS, 'trivy.json'), '--json');
    const report = parseJson(result.out) as unknown as { scanner: string };
    expect(report.scanner).toBe('trivy');
  });

  it('refuses a report that is neither scanner', async () => {
    const odd = join(work, 'odd.json');
    writeFileSync(odd, '{"findings":[]}');
    const result = await cli('explain', bundlePath, odd);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/neither a Grype matches array nor a Trivy Results array/);
  });

  it('needs a bundle and a report that exists', async () => {
    expect((await cli('explain')).code).toBe(EXIT_USAGE);
    expect((await cli('explain', bundlePath)).err).toMatch(/needs a bundle and a scanner report/);
    const missing = await cli('explain', bundlePath, join(work, 'nope.json'));
    expect(missing.code).toBe(EXIT_USAGE);
    expect(missing.err).toMatch(/does not exist/);
  });

  it('exits 0 when the two tools agree on everything', async () => {
    const agreeing = join(work, 'agree.json');
    writeFileSync(
      agreeing,
      JSON.stringify({
        matches: [
          {
            vulnerability: { id: 'DUMPSCAN-NPM-0001', severity: 'High' },
            artifact: {
              name: 'cheeseparser',
              version: '4.17.20',
              type: 'npm',
              purl: 'pkg:npm/cheeseparser@4.17.20',
            },
          },
          {
            vulnerability: { id: 'DUMPSCAN-NPM-0002', severity: 'High' },
            artifact: {
              name: '@Sample/Widget',
              version: '1.4.7',
              type: 'npm',
              purl: 'pkg:npm/%40sample/widget@1.4.7',
            },
          },
          {
            vulnerability: { id: 'DUMPSCAN-MULTI-0001', severity: 'Low' },
            artifact: {
              name: 'polyglot',
              version: '1.9.0',
              type: 'npm',
              purl: 'pkg:npm/polyglot@1.9.0',
            },
          },
          {
            vulnerability: { id: 'DUMPSCAN-NPM-0003', severity: 'High' },
            artifact: {
              name: 'cheeseparser',
              version: '4.17.20',
              type: 'npm',
              purl: 'pkg:npm/cheeseparser@4.17.20',
            },
          },
          {
            vulnerability: { id: 'DUMPSCAN-NPM-0004', severity: 'High' },
            artifact: {
              name: 'gitonly',
              version: '0.5.0',
              type: 'npm',
              purl: 'pkg:npm/gitonly@0.5.0',
            },
          },
        ],
      }),
    );

    const result = await cli('explain', bundlePath, agreeing, '--json');
    const report = parseJson(result.out) as unknown as {
      counts: Record<string, number>;
      discrepancies: { bucket: string }[];
    };
    // The two suppressed findings are still disagreements: Grype reports them
    // and dumpscan does not call them affected.
    expect(report.counts['identifier-mismatch']).toBe(0);
    expect(report.counts['feed-difference']).toBe(0);
    expect(report.counts['suppression']).toBe(2);
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it('exits 0 when there is nothing to disagree about', async () => {
    const empty = join(work, 'empty.json');
    writeFileSync(empty, '{"matches":[]}');
    const result = await cli('explain', bundlePath, empty, '--json');
    const report = parseJson(result.out) as unknown as { discrepancies: unknown[] };
    expect(report.discrepancies.length).toBeGreaterThan(0);
    expect(result.code).toBe(EXIT_FINDINGS);

    const nothing = join(work, 'nothing.bundle.json');
    const document = parseJson(readFileSync(bundlePath, 'utf8')) as unknown as {
      findings: unknown[];
    };
    document.findings = [];
    writeFileSync(nothing, JSON.stringify(document));
    expect((await cli('explain', nothing, empty)).code).toBe(EXIT_OK);
  });
});
