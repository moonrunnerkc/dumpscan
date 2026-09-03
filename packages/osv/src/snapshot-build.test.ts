import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { digest, parseJson } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import { buildSnapshot } from './snapshot-build.js';
import { MANIFEST_FILE, recordPath } from './snapshot-layout.js';

const FIXTURE_RECORDS = new URL('../../../fixtures/osv/synthetic/records', import.meta.url)
  .pathname;
const EXPECTED = JSON.parse(
  readFileSync(new URL('../../../fixtures/osv/synthetic/expected.json', import.meta.url), 'utf8'),
) as {
  feedDigest: string;
  manifestDigest: string;
  recordsWritten: number;
  recordsSkipped: number;
  ecosystemRecordCounts: Record<string, number>;
};

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `dumpscan-${prefix}-`));
}

function tree(root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(root, full).split('\\').join('/'), readFileSync(full));
    }
  };
  walk(root);
  return out;
}

describe('buildSnapshot', () => {
  it('reproduces the committed feed digest for the synthetic fixture', () => {
    const result = buildSnapshot(FIXTURE_RECORDS, scratch('expected'));
    expect(result.feedDigest).toBe(EXPECTED.feedDigest);
    expect(result.manifestDigest).toBe(EXPECTED.manifestDigest);
    expect(result.recordsWritten).toBe(EXPECTED.recordsWritten);
    expect(result.recordsSkipped).toBe(EXPECTED.recordsSkipped);
    expect(
      Object.fromEntries(result.manifest.ecosystems.map((e) => [e.ecosystem, e.recordCount])),
    ).toStrictEqual(EXPECTED.ecosystemRecordCounts);
  });

  it('writes byte identical trees into two different directories', () => {
    const left = scratch('a');
    const right = scratch('b');
    buildSnapshot(FIXTURE_RECORDS, left);
    buildSnapshot(FIXTURE_RECORDS, right);

    const a = tree(left);
    const b = tree(right);
    expect([...a.keys()]).toStrictEqual([...b.keys()]);
    for (const [path, bytes] of a) {
      expect(bytes.equals(b.get(path) as Buffer)).toBe(true);
    }
  });

  it('names every record file after the hash of its own contents', () => {
    const out = scratch('addressed');
    buildSnapshot(FIXTURE_RECORDS, out);
    for (const [path, bytes] of tree(out)) {
      if (!path.startsWith('records/')) continue;
      const recordDigest = digest(bytes);
      expect(recordPath(recordDigest)).toBe(path);
    }
  });

  it('drops records whose only ecosystem was not requested', () => {
    const out = scratch('filtered');
    const result = buildSnapshot(FIXTURE_RECORDS, out, { ecosystems: ['npm'] });
    expect(result.manifest.ecosystems.map((e) => e.ecosystem)).toStrictEqual(['npm']);
    expect(result.recordsWritten).toBe(EXPECTED.ecosystemRecordCounts['npm']);
    expect(result.recordsSkipped).toBe(EXPECTED.recordsWritten + 1 - result.recordsWritten);
  });

  it('indexes a record under every affected package name it declares', () => {
    const out = scratch('index');
    buildSnapshot(FIXTURE_RECORDS, out);
    const index = parseJson(readFileSync(join(out, 'index', 'npm.json'), 'utf8')) as {
      packages: Record<string, string[]>;
    };
    expect(Object.keys(index.packages).sort()).toStrictEqual([
      '@sample/widget',
      'cheeseparser',
      'gitonly',
      'polyglot',
    ]);
    expect(index.packages['cheeseparser']).toHaveLength(2);
  });

  it('indexes PyPI names under their PEP 503 form', () => {
    const out = scratch('pypi');
    buildSnapshot(FIXTURE_RECORDS, out);
    const index = parseJson(readFileSync(join(out, 'index', 'pypi.json'), 'utf8')) as {
      packages: Record<string, string[]>;
    };
    expect(index.packages['sample-client']).toHaveLength(2);
  });

  it('records the source provenance it is handed, and only that', () => {
    const out = scratch('sources');
    const result = buildSnapshot(FIXTURE_RECORDS, out, {
      ecosystems: ['npm', 'PyPI'],
      sources: {
        npm: { url: 'https://example.invalid/npm/all.zip', etag: 'W/"abc"', lastModified: null },
      },
    });
    const [npm, pypi] = [
      result.manifest.ecosystems.find((e) => e.ecosystem === 'npm'),
      result.manifest.ecosystems.find((e) => e.ecosystem === 'PyPI'),
    ];
    expect(npm?.source?.etag).toBe('W/"abc"');
    expect(pypi?.source).toBeNull();
  });

  it('collects the distinct OSV schema versions it saw', () => {
    const out = scratch('schema');
    const result = buildSnapshot(FIXTURE_RECORDS, out);
    expect(result.manifest.osvSchemaVersions).toStrictEqual(['1.6.0']);
  });

  it('produces the empty tree root for an ecosystem with no records', () => {
    const empty = scratch('empty-src');
    mkdirSync(join(empty, 'records'), { recursive: true });
    const result = buildSnapshot(empty, scratch('empty-out'), { ecosystems: ['Go'] });
    expect(result.recordsWritten).toBe(0);
    expect(result.manifest.ecosystems[0]?.root).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('names the offending file when a record cannot be parsed', () => {
    const src = scratch('bad');
    mkdirSync(join(src, 'nested'), { recursive: true });
    writeFileSync(join(src, 'nested', 'broken.json'), '{"id":"X"}');
    expect(() => buildSnapshot(src, scratch('bad-out'))).toThrow(
      /nested\/broken\.json has no modified/,
    );
  });

  it('refuses to build when a record declares an unsupported schema major', () => {
    const src = scratch('future');
    writeFileSync(join(src, 'future.json'), '{"schema_version":"2.0.0","id":"X","modified":"M"}');
    expect(() => buildSnapshot(src, scratch('future-out'))).toThrow(/schema major version 2/);
  });

  it('ignores files that are not JSON records', () => {
    const src = scratch('mixed');
    writeFileSync(join(src, 'README.txt'), 'not a record');
    writeFileSync(join(src, 'a.json'), '{"id":"A","modified":"M","affected":[]}');
    const result = buildSnapshot(src, scratch('mixed-out'));
    expect(result.recordsSkipped).toBe(1);
    expect(result.recordsWritten).toBe(0);
  });

  it('writes a manifest whose bytes hash to the reported manifest digest', () => {
    const out = scratch('manifest');
    const result = buildSnapshot(FIXTURE_RECORDS, out);
    expect(digest(readFileSync(join(out, MANIFEST_FILE)))).toBe(result.manifestDigest);
  });
});
