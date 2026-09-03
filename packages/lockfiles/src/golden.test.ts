import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import type { JsonValue } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import { inputDigest, manifestToJson } from './manifest.js';
import { parseLockfile } from './registry.js';

const CASES_DIR = new URL('../../../fixtures/lockfiles', import.meta.url).pathname;

interface Golden {
  readonly lockfile: string;
  readonly format?: string;
  readonly refused?: string;
  readonly manifests?: readonly { readonly inputDigest: string; readonly manifest: JsonValue }[];
}

function lockfileIn(dir: string): string {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'expected.json') continue;
    if (statSync(join(dir, entry)).isFile()) return entry;
  }
  throw new Error(`golden fixture ${dir} has no lockfile beside its expected.json`);
}

const cases = readdirSync(CASES_DIR).sort();

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
    expect([...formats].sort()).toStrictEqual([
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
    const filename = lockfileIn(dir);
    expect(filename).toBe(golden.lockfile);
    const bytes = readFileSync(join(dir, filename));

    if (golden.refused !== undefined) {
      expect(() => parseLockfile(filename, bytes)).toThrow(golden.refused);
      return;
    }

    const parsed = parseLockfile(filename, bytes);
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
    const filename = lockfileIn(dir);
    const bytes = readFileSync(join(dir, filename));
    let first: string;
    try {
      first = JSON.stringify(parseLockfile(filename, bytes).manifests.map(manifestToJson));
    } catch (error) {
      expect(() => parseLockfile(filename, bytes)).toThrow((error as Error).message);
      return;
    }
    const second = JSON.stringify(parseLockfile(filename, bytes).manifests.map(manifestToJson));
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
