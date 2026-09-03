import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import { buildSnapshot } from '@dumpscan/osv';
import { generatePlainKey } from '@dumpscan/sign';
import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE } from './exit.js';
import { run } from './index.js';

const RECORDS = new URL('../../../fixtures/osv/synthetic/records', import.meta.url).pathname;
const BUNDLE_FIXTURE = new URL('../../../fixtures/bundles/synthetic-npm-pypi', import.meta.url)
  .pathname;

let work = '';
let snapshotDir = '';
let feedDigest = '';
let keyPath = '';
let bundlePath = '';

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out = capture();
  const err = capture();
  const code = await run(argv, out.write, err.write);
  return { code, out: out.lines.join('\n'), err: err.lines.join('\n') };
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'dumpscan-e2e-'));
  snapshotDir = join(work, 'snapshot');
  feedDigest = buildSnapshot(RECORDS, snapshotDir).feedDigest;

  const key = generatePlainKey();
  keyPath = join(work, 'signing.key.pem');
  writeFileSync(keyPath, key.privateKeyPem);
  bundlePath = join(work, 'scan.bundle.json');
});

describe('dumpscan scan', () => {
  it('refuses to run without a snapshot rather than picking one', async () => {
    const result = await cli('scan', join(BUNDLE_FIXTURE, 'package-lock.json'));
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/--snapshot is required/);
    expect(result.err).toMatch(/never picks a snapshot for you/);
  });

  it('refuses a filename no parser claims', async () => {
    const odd = join(work, 'deps.lock');
    writeFileSync(odd, '{}');
    const result = await cli('scan', odd, '--snapshot', snapshotDir);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/no parser reads "deps.lock"/);
  });

  it('refuses a lockfile path that is not a file', async () => {
    const result = await cli('scan', join(work, 'nope.json'), '--snapshot', snapshotDir);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/is not a file/);
  });

  it('refuses a snapshot reference that resolves to nothing', async () => {
    const result = await cli(
      'scan',
      join(BUNDLE_FIXTURE, 'package-lock.json'),
      '--snapshot',
      join(work, 'not-a-snapshot'),
    );
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/neither a snapshot directory nor a sha256: feed digest/);
  });

  it('scans a lockfile, signs it with a plain key, and exits 1 for affected findings', async () => {
    const result = await cli(
      'scan',
      join(BUNDLE_FIXTURE, 'package-lock.json'),
      '--snapshot',
      snapshotDir,
      '--key',
      keyPath,
      '--out',
      bundlePath,
    );
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).toContain(feedDigest);
    expect(result.out).toMatch(/findings {6}5 total, 3 affected/);

    const bundle = parseJson(readFileSync(bundlePath, 'utf8')) as unknown as {
      bundleVersion: string;
      statement: { predicateType: string; predicate: { findingsRoot: string } };
      attestation: { kind: string };
      findings: unknown[];
    };
    expect(bundle.bundleVersion).toBe('dumpscan.bundle/v1');
    expect(bundle.statement.predicateType).toBe('https://dumpscan.dev/scan/v1');
    expect(bundle.attestation.kind).toBe('plain-key');
    expect(bundle.findings).toHaveLength(5);
  });

  it('exits 0 when nothing is affected', async () => {
    const cleanDir = join(work, 'clean');
    mkdirSync(cleanDir, { recursive: true });
    const clean = join(cleanDir, 'package-lock.json');
    writeFileSync(
      clean,
      JSON.stringify({
        name: 'clean',
        lockfileVersion: 3,
        packages: {
          '': { name: 'clean' },
          'node_modules/cheeseparser': { version: '4.17.21' },
        },
      }),
    );
    const result = await cli(
      'scan',
      clean,
      '--snapshot',
      snapshotDir,
      '--out',
      join(work, 'clean.bundle.json'),
    );
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toMatch(/findings {6}1 total, 0 affected/);
  });

  it('refuses a workspace the lockfile does not resolve', async () => {
    const result = await cli(
      'scan',
      join(BUNDLE_FIXTURE, 'package-lock.json'),
      '--snapshot',
      snapshotDir,
      '--workspace',
      'packages/nope',
    );
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/has no workspace "packages\/nope"; it resolves \./);
  });

  it('produces the same bundle bytes on a second run', async () => {
    const first = join(work, 'a.bundle.json');
    const second = join(work, 'b.bundle.json');
    const lockfile = join(BUNDLE_FIXTURE, 'requirements.txt');
    await cli('scan', lockfile, '--snapshot', snapshotDir, '--out', first);
    await cli('scan', lockfile, '--snapshot', snapshotDir, '--out', second);
    expect(readFileSync(second)).toStrictEqual(readFileSync(first));
  });
});

describe('dumpscan verify', () => {
  it('verifies a plain-key bundle offline and says it carries no identity', async () => {
    const result = await cli('verify', bundlePath);
    expect(result.out).toContain('ok   findings-root');
    expect(result.out).toContain('ok   signature');
    expect(result.out).toContain('ok   payload-binding');
    expect(result.out).toContain('FAIL identity');
    expect(result.out).toMatch(/binds it to no identity/);
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it('fails every digest check when a finding is edited', async () => {
    const tampered = join(work, 'tampered.bundle.json');
    const text = readFileSync(bundlePath, 'utf8');
    writeFileSync(tampered, text.replace('"status":"affected"', '"status":"excluded"'));

    const result = await cli('verify', tampered, '--json');
    const report = parseJson(result.out) as unknown as {
      passed: boolean;
      checks: { name: string; passed: boolean }[];
    };
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === 'findings-root')?.passed).toBe(false);
    expect(report.checks.find((check) => check.name === 'signature')?.passed).toBe(true);
  });

  it('fails the signature check when the envelope is edited', async () => {
    const tampered = join(work, 'resigned.bundle.json');
    const document = parseJson(readFileSync(bundlePath, 'utf8')) as unknown as {
      attestation: { envelope: { signatures: { sig: string }[] } };
    };
    const signature = document.attestation.envelope.signatures[0] as { sig: string };
    signature.sig = Buffer.from(Buffer.from(signature.sig, 'base64').reverse()).toString('base64');
    writeFileSync(tampered, JSON.stringify(document));

    const result = await cli('verify', tampered, '--json');
    const report = parseJson(result.out) as unknown as {
      checks: { name: string; passed: boolean }[];
    };
    expect(report.checks.find((check) => check.name === 'signature')?.passed).toBe(false);
  });

  it('needs a bundle path', async () => {
    const result = await cli('verify');
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/needs a bundle path/);
  });
});

describe('dumpscan prove', () => {
  it('proves a finding against the findings root and the advisory against the feed', async () => {
    const result = await cli('prove', bundlePath, 'DUMPSCAN-NPM-0001', '--snapshot', snapshotDir);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toMatch(/finding {3}DUMPSCAN-NPM-0001 is leaf \d+ of 5/);
    expect(result.out).toContain('verified');
    expect(result.out).toContain(`feed      ${feedDigest}`);
  });

  it('reports absence with the whole leaf set rather than a path', async () => {
    const result = await cli('prove', bundlePath, 'GHSA-not-here', '--json');
    expect(result.code).toBe(EXIT_FINDINGS);
    const report = parseJson(result.out) as unknown as {
      finding: { present: boolean; treeSize: number; leaves: string[] };
    };
    expect(report.finding.present).toBe(false);
    expect(report.finding.leaves).toHaveLength(report.finding.treeSize);
  });

  it('proves inclusion without a snapshot and says the feed was not checked', async () => {
    const result = await cli('prove', bundlePath, 'DUMPSCAN-NPM-0001');
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toMatch(/no --snapshot given/);
  });

  it('needs a bundle and an advisory id', async () => {
    expect((await cli('prove', bundlePath)).code).toBe(EXIT_USAGE);
    expect((await cli('prove')).err).toMatch(/needs a bundle and an advisory id/);
  });
});

describe('dumpscan top level', () => {
  it('prints help and exits 2 when no command is given', async () => {
    const result = await cli();
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.out).toContain('dumpscan <command>');
  });

  it('prints help and exits 0 for --help and for the help command', async () => {
    expect((await cli('--help')).code).toBe(EXIT_OK);
    expect((await cli('help')).code).toBe(EXIT_OK);
    expect((await cli('scan', '--help')).out).toContain('dumpscan <command>');
  });

  it('prints the version', async () => {
    const result = await cli('--version');
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rejects a short flag rather than guessing what it means', async () => {
    const result = await cli('scan', '-s', 'x');
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/is not an option dumpscan accepts/);
  });

  it('rejects an unknown command by name', async () => {
    const result = await cli('scam');
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/"scam" is not a dumpscan command/);
  });
});
