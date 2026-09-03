import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { DEFAULT_OSV_BASE_URL, downloadEcosystems } from './download.js';

const encoder = new TextEncoder();

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `dumpscan-${prefix}-`));
}

function archive(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, body]) => [name, encoder.encode(body)])),
  );
}

function respondWith(
  body: Uint8Array,
  headers: Record<string, string> = {},
): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = ((url: string) => {
    urls.push(url);
    return Promise.resolve(new Response(body, { status: 200, headers: new Headers(headers) }));
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

describe('downloadEcosystems', () => {
  it('unpacks the archive and records the ETag and Last-Modified it saw', async () => {
    const { fetchImpl, urls } = respondWith(
      archive({ 'GHSA-1.json': '{"id":"GHSA-1"}', 'nested/GHSA-2.json': '{"id":"GHSA-2"}' }),
      { etag: 'W/"abc123"', 'last-modified': 'Tue, 02 Sep 2025 00:00:00 GMT' },
    );
    const out = scratch('download');
    const results = await downloadEcosystems({ ecosystems: ['npm'], outDir: out, fetchImpl });

    expect(urls).toStrictEqual([`${DEFAULT_OSV_BASE_URL}/npm/all.zip`]);
    expect(results[0]?.recordCount).toBe(2);
    expect(results[0]?.source).toStrictEqual({
      url: `${DEFAULT_OSV_BASE_URL}/npm/all.zip`,
      etag: 'W/"abc123"',
      lastModified: 'Tue, 02 Sep 2025 00:00:00 GMT',
    });
    expect(readFileSync(join(out, 'npm', 'GHSA-1.json'), 'utf8')).toBe('{"id":"GHSA-1"}');
    expect(readFileSync(join(out, 'npm', 'nested', 'GHSA-2.json'), 'utf8')).toBe('{"id":"GHSA-2"}');
  });

  it('records nulls when the server sends no validators', async () => {
    const { fetchImpl } = respondWith(archive({ 'a.json': '{}' }));
    const results = await downloadEcosystems({
      ecosystems: ['PyPI'],
      outDir: scratch('novalidator'),
      fetchImpl,
    });
    expect(results[0]?.source.etag).toBeNull();
    expect(results[0]?.source.lastModified).toBeNull();
  });

  it('percent encodes the ecosystem and honours a mirror base url', async () => {
    const { fetchImpl, urls } = respondWith(archive({ 'a.json': '{}' }));
    await downloadEcosystems({
      ecosystems: ['crates.io'],
      outDir: scratch('mirror'),
      baseUrl: 'https://mirror.invalid/osv/',
      fetchImpl,
    });
    expect(urls).toStrictEqual(['https://mirror.invalid/osv/crates.io/all.zip']);
  });

  it('writes one subdirectory per ecosystem', async () => {
    const { fetchImpl } = respondWith(archive({ 'a.json': '{}' }));
    const out = scratch('multi');
    await downloadEcosystems({ ecosystems: ['npm', 'PyPI'], outDir: out, fetchImpl });
    expect(readdirSync(out).sort()).toStrictEqual(['npm', 'pypi']);
  });

  it('ignores non JSON entries in the archive', async () => {
    const { fetchImpl } = respondWith(archive({ 'a.json': '{}', LICENSE: 'text' }));
    const out = scratch('nonjson');
    const results = await downloadEcosystems({ ecosystems: ['Go'], outDir: out, fetchImpl });
    expect(results[0]?.recordCount).toBe(1);
    expect(readdirSync(join(out, 'go'))).toStrictEqual(['a.json']);
  });

  it('refuses to write outside the output directory', async () => {
    const { fetchImpl } = respondWith(archive({ '../escape.json': '{}' }));
    const out = scratch('escape');
    await downloadEcosystems({ ecosystems: ['npm'], outDir: out, fetchImpl });
    expect(readdirSync(join(out, 'npm'))).toStrictEqual(['escape.json']);
  });

  it('reports the status when the mirror rejects the request', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('gone', { status: 404, statusText: 'Not Found' }),
      )) as unknown as typeof fetch;
    await expect(
      downloadEcosystems({ ecosystems: ['npm'], outDir: scratch('404'), fetchImpl }),
    ).rejects.toThrow(/responded 404 Not Found/);
  });

  it('says so when a 200 response is not a zip archive', async () => {
    const { fetchImpl } = respondWith(encoder.encode('<html>error page</html>'));
    await expect(
      downloadEcosystems({ ecosystems: ['npm'], outDir: scratch('nonzip'), fetchImpl }),
    ).rejects.toThrow(/did not decode as a zip archive/);
  });
});
