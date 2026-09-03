import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import type { JsonValue } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import { inputDigest, manifestToJson } from './manifest.js';
import { parseLockfile, parserFor } from './registry.js';

const CASES_DIR = new URL('../../../fixtures/lockfiles', import.meta.url).pathname;

interface Golden {
  readonly lockfile: string;
  readonly sidecars?: readonly string[];
  readonly format?: string;
  readonly refused?: string;
  readonly manifests?: readonly { readonly inputDigest: string; readonly manifest: JsonValue }[];
}

/**
 * A fixture directory holds one lockfile plus any sidecars a parser reads, such
 * as the go.mod beside a go.sum. The parser registry decides which is which.
 */
function splitDirectory(dir: string): { lockfile: string; sidecars: Record<string, string> } {
  const files = readdirSync(dir)
    .sort(byName)
    .filter((entry) => entry !== 'expected.json' && statSync(join(dir, entry)).isFile());
  const lockfile = files.find((entry) => parserFor(entry) !== undefined);
  if (lockfile === undefined) {
    throw new Error(`golden fixture ${dir} has no file any parser claims`);
  }
  const sidecars: Record<string, string> = {};
  for (const entry of files) {
    if (entry !== lockfile) sidecars[entry] = readFileSync(join(dir, entry), 'utf8');
  }
  return { lockfile, sidecars };
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const cases = readdirSync(CASES_DIR).sort(byName);

describe('lockfile goldens', () => {
  it('covers every format dumpscan claims to read', () => {
    const formats = new Set(
      cases.map((name) => {
        const golden = parseJson(
          readFileSync(join(CASES_DIR, name, 'expected.json'), 'utf8'),
        ) as unknown as Golden;
        return golden.lockfile.toLowerCase();
      }),
    );
    expect([...formats].sort(byName)).toStrictEqual([
      'cargo.lock',
      'dependency-list.txt',
      'go.sum',
      'gradle.lockfile',
      'package-lock.json',
      'pipfile.lock',
      'pnpm-lock.yaml',
      'poetry.lock',
      'requirements.txt',
      'uv.lock',
      'yarn.lock',
    ]);
  });

  it.each(cases)('%s parses to its committed manifest', (name) => {
    const dir = join(CASES_DIR, name);
    const golden = parseJson(readFileSync(join(dir, 'expected.json'), 'utf8')) as unknown as Golden;
    const { lockfile: filename, sidecars } = splitDirectory(dir);
    expect(filename).toBe(golden.lockfile);
    expect(Object.keys(sidecars)).toStrictEqual([...(golden.sidecars ?? [])]);
    const bytes = readFileSync(join(dir, filename));

    if (golden.refused !== undefined) {
      expect(() => parseLockfile(filename, bytes, sidecars)).toThrow(golden.refused);
      return;
    }

    const parsed = parseLockfile(filename, bytes, sidecars);
    expect(parsed.format).toBe(golden.format);
    expect(
      parsed.manifests.map((manifest) => ({
        inputDigest: inputDigest(manifest),
        manifest: manifestToJson(manifest),
      })),
    ).toStrictEqual(golden.manifests);
  });

  it.each(cases)('%s parses identically on a second run', (name) => {
    const dir = join(CASES_DIR, name);
    const { lockfile: filename, sidecars } = splitDirectory(dir);
    const bytes = readFileSync(join(dir, filename));
    let first: string;
    try {
      first = JSON.stringify(
        parseLockfile(filename, bytes, sidecars).manifests.map(manifestToJson),
      );
    } catch (error) {
      expect(() => parseLockfile(filename, bytes, sidecars)).toThrow((error as Error).message);
      return;
    }
    const second = JSON.stringify(
      parseLockfile(filename, bytes, sidecars).manifests.map(manifestToJson),
    );
    expect(second).toBe(first);
  });

  it('gives every manifest of a workspace lockfile a distinct input digest', () => {
    for (const name of cases) {
      const dir = join(CASES_DIR, name);
      const golden = parseJson(
        readFileSync(join(dir, 'expected.json'), 'utf8'),
      ) as unknown as Golden;
      if (golden.manifests === undefined || golden.manifests.length < 2) continue;
      const digests = golden.manifests.map((entry) => entry.inputDigest);
      expect(new Set(digests).size).toBe(digests.length);
    }
  });
});
