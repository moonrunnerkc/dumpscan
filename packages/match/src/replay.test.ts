import { fileURLToPath } from 'node:url';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import type { JsonValue } from '@dumpscan/canon';
import { inputDigest, manifestToJson, parseLockfile, parserFor } from '@dumpscan/lockfiles';
import { buildSnapshot, openSnapshot } from '@dumpscan/osv';
import { rulesetDigest } from '@dumpscan/versions';
import { beforeAll, describe, expect, it } from 'vitest';

import { matchManifest } from './engine.js';
import { findingToJson } from './finding.js';

const BUNDLES = fileURLToPath(new URL('../../../fixtures/bundles', import.meta.url));
const RECORDS = fileURLToPath(new URL('../../../fixtures/osv/synthetic/records', import.meta.url));

interface Scan {
  readonly lockfile: string;
  readonly workspaceRoot: string;
  readonly inputDigest: string;
  readonly matcherVersion: string;
  readonly findingsRoot: string;
  readonly findingsCount: number;
  readonly ecosystems: readonly string[];
  readonly manifest: JsonValue;
  readonly findings: readonly JsonValue[];
}

interface Bundle {
  readonly feedDigest: string;
  readonly snapshotManifestDigest: string;
  readonly comparatorRulesetDigest: string;
  readonly exclusionsDigest: string | null;
  readonly scans: readonly Scan[];
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const cases = readdirSync(BUNDLES).sort(byName);

let snapshotDir = '';
let feedDigest = '';
let snapshotManifestDigest = '';

beforeAll(() => {
  snapshotDir = mkdtempSync(join(tmpdir(), 'dumpscan-replay-'));
  const built = buildSnapshot(RECORDS, snapshotDir);
  feedDigest = built.feedDigest;
  snapshotManifestDigest = built.manifestDigest;
});

function bundleOf(name: string): Bundle {
  return parseJson(readFileSync(join(BUNDLES, name, 'expected.json'), 'utf8')) as unknown as Bundle;
}

/**
 * Files a parser claims are lockfiles; everything else beside them is a sidecar,
 * such as the go.mod a go.sum reads to learn the main module path.
 */
function splitDirectory(dir: string): { lockfiles: string[]; sidecars: Record<string, string> } {
  const files = readdirSync(dir)
    .sort(byName)
    .filter((entry) => entry !== 'expected.json' && statSync(join(dir, entry)).isFile());
  const lockfiles = files.filter((entry) => parserFor(entry) !== undefined);
  const sidecars: Record<string, string> = {};
  for (const entry of files) {
    if (!lockfiles.includes(entry)) sidecars[entry] = readFileSync(join(dir, entry), 'utf8');
  }
  return { lockfiles, sidecars };
}

describe('replay', () => {
  it('has at least one bundle to replay', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('%s reproduces its committed digests', (name) => {
    const bundle = bundleOf(name);
    expect(feedDigest).toBe(bundle.feedDigest);
    expect(snapshotManifestDigest).toBe(bundle.snapshotManifestDigest);
    expect(rulesetDigest()).toBe(bundle.comparatorRulesetDigest);
    expect(bundle.exclusionsDigest).toBeNull();
  });

  it.each(cases)('%s reproduces its committed findings root', (name) => {
    const bundle = bundleOf(name);
    const snapshot = openSnapshot(snapshotDir);
    const produced: Scan[] = [];

    const { lockfiles, sidecars } = splitDirectory(join(BUNDLES, name));
    for (const filename of lockfiles) {
      const parsed = parseLockfile(filename, readFileSync(join(BUNDLES, name, filename)), sidecars);
      for (const manifest of parsed.manifests) {
        const result = matchManifest(manifest, snapshot);
        produced.push({
          lockfile: filename,
          workspaceRoot: manifest.workspaceRoot,
          inputDigest: inputDigest(manifest),
          matcherVersion: result.matcherVersion,
          findingsRoot: result.findingsRoot,
          findingsCount: result.findings.length,
          ecosystems: result.ecosystems,
          manifest: manifestToJson(manifest),
          findings: result.findings.map(findingToJson),
        });
      }
    }

    expect(produced).toStrictEqual(bundle.scans);
  });

  it.each(cases)('%s replays identically from a second snapshot build', (name) => {
    const bundle = bundleOf(name);
    const rebuilt = mkdtempSync(join(tmpdir(), 'dumpscan-replay-again-'));
    expect(buildSnapshot(RECORDS, rebuilt).feedDigest).toBe(bundle.feedDigest);
    const snapshot = openSnapshot(rebuilt);

    for (const scan of bundle.scans) {
      const parsed = parseLockfile(scan.lockfile, readFileSync(join(BUNDLES, name, scan.lockfile)));
      const manifest = parsed.manifests.find(
        (candidate) => candidate.workspaceRoot === scan.workspaceRoot,
      );
      expect(manifest).toBeDefined();
      expect(matchManifest(manifest as NonNullable<typeof manifest>, snapshot).findingsRoot).toBe(
        scan.findingsRoot,
      );
    }
  });

  it('covers every finding status the matcher can produce without exclusions', () => {
    const statuses = new Set(
      cases.flatMap((name) =>
        bundleOf(name).scans.flatMap((scan) =>
          scan.findings.map((finding) => (finding as { status: string }).status),
        ),
      ),
    );
    expect([...statuses].sort(byName)).toStrictEqual([
      'affected',
      'unevaluated',
      'withdrawn-suppressed',
    ]);
  });

  it('covers every ecosystem dumpscan scans', () => {
    const ecosystems = new Set(
      cases.flatMap((name) => bundleOf(name).scans.flatMap((scan) => [...scan.ecosystems])),
    );
    expect([...ecosystems].sort(byName)).toStrictEqual(['Go', 'Maven', 'PyPI', 'crates.io', 'npm']);
  });
});
