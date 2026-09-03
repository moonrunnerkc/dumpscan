import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJson } from '@dumpscan/canon';
import { buildSnapshot } from '@dumpscan/osv';
import { generatePlainKey } from '@dumpscan/sign';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT_OK, EXIT_USAGE } from './exit.js';
import { run } from './index.js';
import { packSnapshot, unpackSnapshot } from './snapshot-archive.js';
import { fetchSnapshot, INDEX_FILE, readStoreIndex } from './snapshot-fetch.js';
import { resolveSnapshotWithStores } from './snapshot-resolver.js';

const RECORDS = new URL('../../../fixtures/osv/synthetic/records', import.meta.url).pathname;
const FIXTURE = new URL('../../../fixtures/bundles/synthetic-npm-pypi', import.meta.url).pathname;

let work = '';
let snapshotDir = '';
let releaseDir = '';
let feedDigest = '';
let keyPath = '';
let server: Server;
let storeUrl = '';

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
  work = mkdtempSync(join(tmpdir(), 'dumpscan-publish-'));
  snapshotDir = join(work, 'snapshot');
  releaseDir = join(work, 'release');
  feedDigest = buildSnapshot(RECORDS, snapshotDir).feedDigest;

  const key = generatePlainKey();
  keyPath = join(work, 'snapshot.key.pem');
  writeFileSync(keyPath, key.privateKeyPem);

  await cli('publish', snapshotDir, '--out', releaseDir, '--date', '2026-09-03', '--key', keyPath);

  server = createServer((request, response) => {
    const name = (request.url ?? '/').replace(/^\//, '').split('?')[0] ?? '';
    const path = join(releaseDir, name);
    if (name === '' || name.includes('..') || !existsSync(path)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200).end(readFileSync(path));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  storeUrl = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
});

afterAll(async () => {
  await new Promise<void>((done) =>
    server.close(() => {
      done();
    }),
  );
});

describe('packSnapshot', () => {
  it('produces the same archive bytes every time', () => {
    const a = packSnapshot(snapshotDir);
    const b = packSnapshot(snapshotDir);
    expect(b.digest).toBe(a.digest);
    expect(Buffer.from(b.bytes).equals(Buffer.from(a.bytes))).toBe(true);
  });

  it('round trips through unpack', () => {
    const out = join(work, 'unpacked');
    const written = unpackSnapshot(packSnapshot(snapshotDir).bytes, out, 'test');
    expect(written).toBeGreaterThan(0);
    expect(existsSync(join(out, 'manifest.json'))).toBe(true);
    expect(readFileSync(join(out, 'manifest.json'))).toStrictEqual(
      readFileSync(join(snapshotDir, 'manifest.json')),
    );
  });

  it('refuses bytes that are not a gzip archive', () => {
    expect(() => unpackSnapshot(new TextEncoder().encode('<html>'), work, 'store')).toThrow(
      /did not decode as a gzip archive/,
    );
  });
});

describe('dumpscan publish', () => {
  it('writes an archive, an attestation, and an index keyed by the feed digest', () => {
    const hex = feedDigest.slice('sha256:'.length);
    const names = readdirSync(releaseDir).sort();
    expect(names).toStrictEqual([`${hex}.att.json`, `${hex}.tar.gz`, INDEX_FILE]);

    const index = parseJson(
      readFileSync(join(releaseDir, INDEX_FILE), 'utf8'),
    ) as unknown as Record<string, string>;
    expect(index['2026-09-03']).toBe(feedDigest);
  });

  it('attests the manifest and the feed digest', () => {
    const hex = feedDigest.slice('sha256:'.length);
    const attestation = parseJson(
      readFileSync(join(releaseDir, `${hex}.att.json`), 'utf8'),
    ) as unknown as {
      statement: { predicateType: string; predicate: { feedDigest: string; sources: unknown[] } };
      attestation: { kind: string };
    };
    expect(attestation.statement.predicateType).toBe('https://dumpscan.dev/snapshot/v1');
    expect(attestation.statement.predicate.feedDigest).toBe(feedDigest);
    expect(attestation.statement.predicate.sources).toHaveLength(5);
    expect(attestation.attestation.kind).toBe('plain-key');
  });

  it('keeps earlier dates in the index rather than replacing it', async () => {
    await cli(
      'publish',
      snapshotDir,
      '--out',
      releaseDir,
      '--date',
      '2026-09-04',
      '--key',
      keyPath,
    );
    const index = parseJson(
      readFileSync(join(releaseDir, INDEX_FILE), 'utf8'),
    ) as unknown as Record<string, string>;
    expect(Object.keys(index).sort()).toStrictEqual(['2026-09-03', '2026-09-04']);
  });

  it('needs a snapshot directory, an out directory, and a date', async () => {
    expect((await cli('publish')).err).toMatch(/needs a snapshot directory/);
    expect((await cli('publish', work, '--out', releaseDir, '--date', 'x')).err).toMatch(
      /has no manifest.json/,
    );
    expect((await cli('publish', snapshotDir, '--date', 'x')).err).toMatch(/--out is required/);
    expect((await cli('publish', snapshotDir, '--out', releaseDir)).err).toMatch(
      /--date is required/,
    );

    // A wrong command line leaves the release directory exactly as it was.
    const hex = feedDigest.slice('sha256:'.length);
    const attestation = parseJson(
      readFileSync(join(releaseDir, `${hex}.att.json`), 'utf8'),
    ) as unknown as { attestation: { kind: string } | null };
    expect(attestation.attestation?.kind).toBe('plain-key');
  });
});

describe('fetchSnapshot from a store', () => {
  it('fetches by digest, verifies the attestation, and caches the result', async () => {
    const cache = join(work, 'cache-fetch');
    const result = await fetchSnapshot(feedDigest as `sha256:${string}`, {
      stores: [storeUrl],
      cacheDir: cache,
    });
    expect(result.verified).toBe(true);
    expect(result.notes[0]).toMatch(/plain key, which binds this snapshot to no identity/);
    expect(existsSync(join(result.directory, 'manifest.json'))).toBe(true);
  });

  it('reads the date to digest index', async () => {
    expect(await readStoreIndex(storeUrl)).toMatchObject({ '2026-09-03': feedDigest });
  });

  it('says which stores it tried when none has the digest', async () => {
    await expect(
      fetchSnapshot(`sha256:${'0'.repeat(64)}`, {
        stores: [storeUrl],
        cacheDir: join(work, 'cache-missing'),
      }),
    ).rejects.toThrow(/no configured store has sha256:0{64}\. Tried:/);
  });

  it('refuses to fetch with no store configured', async () => {
    await expect(
      fetchSnapshot(feedDigest as `sha256:${string}`, { stores: [], cacheDir: work }),
    ).rejects.toThrow(/no snapshot store is configured/);
  });

  it('refuses a reference that is not a digest', async () => {
    await expect(
      fetchSnapshot('not-a-digest' as `sha256:${string}`, { stores: [storeUrl], cacheDir: work }),
    ).rejects.toThrow(/is not a sha256: feed digest/);
  });
});

describe('resolveSnapshotWithStores', () => {
  it('prefers the cache and falls back to the store', async () => {
    const cache = join(work, 'cache-resolve');
    const first = await resolveSnapshotWithStores(feedDigest, {
      cacheDir: cache,
      stores: [storeUrl],
    });
    expect(existsSync(join(first, 'manifest.json'))).toBe(true);

    // The second call is served from the cache, so an unreachable store is fine.
    const second = await resolveSnapshotWithStores(feedDigest, {
      cacheDir: cache,
      stores: ['http://127.0.0.1:1'],
    });
    expect(second).toBe(first);
  });

  it('reports the missing digest when neither the cache nor a store has it', async () => {
    await expect(
      resolveSnapshotWithStores(`sha256:${'1'.repeat(64)}`, {
        cacheDir: join(work, 'cache-empty'),
        stores: [],
      }),
    ).rejects.toThrow(/no snapshot with feed digest/);
  });
});

describe('scanning against a fetched snapshot', () => {
  it('scans and replays with an empty cache and only a store to go on', async () => {
    const cache = join(work, 'cache-clean');
    const bundle = join(work, 'fetched.bundle.json');

    const scanned = await cli(
      'scan',
      join(FIXTURE, 'package-lock.json'),
      '--snapshot',
      feedDigest,
      '--store',
      storeUrl,
      '--cache',
      cache,
      '--out',
      bundle,
    );
    expect(scanned.out).toContain(feedDigest);

    const replayed = await cli(
      'replay',
      bundle,
      '--store',
      storeUrl,
      '--cache',
      join(work, 'cache-replay'),
    );
    expect(replayed.code).toBe(EXIT_OK);
    expect(replayed.out).toContain('matches');
  });

  it('says what to do when a digest is not in the cache and no store is set', async () => {
    const result = await cli(
      'scan',
      join(FIXTURE, 'package-lock.json'),
      '--snapshot',
      feedDigest,
      '--cache',
      join(work, 'cache-none'),
    );
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/pass --store <url> to fetch it/);
  });
});
