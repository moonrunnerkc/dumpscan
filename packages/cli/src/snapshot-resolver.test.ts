import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalBytes } from '@dumpscan/canon';
import { buildSnapshot, manifestToJson } from '@dumpscan/osv';
import { describe, expect, it } from 'vitest';

import { UsageError } from './exit.js';
import { DEFAULT_CACHE_DIR, resolveSnapshot } from './snapshot-resolver.js';
import { print } from './output.js';

const RECORDS = fileURLToPath(new URL('../../../fixtures/osv/synthetic/records', import.meta.url));

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `dumpscan-${prefix}-`));
}

describe('resolveSnapshot by path', () => {
  it('accepts a directory that has a manifest', () => {
    const dir = scratch('by-path');
    buildSnapshot(RECORDS, dir);
    expect(resolveSnapshot(dir)).toBe(dir);
  });

  it('refuses a directory that has none, and says how to make one', () => {
    expect(() => resolveSnapshot(scratch('empty'))).toThrow(UsageError);
    expect(() => resolveSnapshot(scratch('empty'))).toThrow(
      /neither a snapshot directory nor a sha256: feed digest/,
    );
  });
});

describe('resolveSnapshot by digest', () => {
  it('finds the snapshot whose manifest declares that feed digest', () => {
    const cache = scratch('cache');
    const wanted = join(cache, 'wanted');
    const other = join(cache, 'aaa-other');
    const built = buildSnapshot(RECORDS, wanted);
    buildSnapshot(RECORDS, other, { ecosystems: ['npm'] });

    expect(resolveSnapshot(built.feedDigest, cache)).toBe(wanted);
  });

  it('ignores a directory with no manifest rather than failing on it', () => {
    const cache = scratch('mixed');
    mkdirSync(join(cache, 'not-a-snapshot'), { recursive: true });
    const dir = join(cache, 'real');
    const built = buildSnapshot(RECORDS, dir);
    expect(resolveSnapshot(built.feedDigest, cache)).toBe(dir);
  });

  it('does not trust the directory name over the manifest', () => {
    const cache = scratch('renamed');
    const built = buildSnapshot(RECORDS, join(cache, 'real'));
    const decoy = join(cache, 'aaa-decoy');
    mkdirSync(decoy, { recursive: true });
    const npmOnly = buildSnapshot(RECORDS, scratch('npm-only'), { ecosystems: ['npm'] });
    writeFileSync(join(decoy, 'manifest.json'), canonicalBytes(manifestToJson(npmOnly.manifest)));

    expect(resolveSnapshot(built.feedDigest, cache)).toBe(join(cache, 'real'));
  });

  it('says where it looked when nothing matches', () => {
    const cache = scratch('missing');
    expect(() => resolveSnapshot(`sha256:${'0'.repeat(64)}`, cache)).toThrow(
      new RegExp(`no snapshot with feed digest sha256:0{64} in ${cache}`),
    );
  });

  it('falls back to the default cache when none is given', () => {
    expect(() => resolveSnapshot(`sha256:${'1'.repeat(64)}`)).toThrow(
      new RegExp(DEFAULT_CACHE_DIR.replaceAll('/', '.')),
    );
    expect(DEFAULT_CACHE_DIR).toMatch(/dumpscan/);
  });

  it('treats an empty cache path as the default', () => {
    expect(() => resolveSnapshot(`sha256:${'2'.repeat(64)}`, '')).toThrow(
      new RegExp(DEFAULT_CACHE_DIR.replaceAll('/', '.')),
    );
  });
});

describe('print', () => {
  it('writes the lines when json was not asked for', () => {
    const lines: string[] = [];
    print({ exitCode: 0, lines: ['a', 'b'], json: { a: 1 } }, false, (line) => lines.push(line));
    expect(lines).toStrictEqual(['a', 'b']);
  });

  it('writes the report as JSON when it was', () => {
    const lines: string[] = [];
    print({ exitCode: 0, lines: ['a'], json: { a: 1 } }, true, (line) => lines.push(line));
    expect(lines).toStrictEqual(['{\n  "a": 1\n}']);
  });
});
