import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { compareCodeUnits, digest } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { gunzipSync, gzipSync } from 'fflate';

const BLOCK = 512;
const NAME_LIMIT = 100;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** File extension of a published snapshot archive. */
export const ARCHIVE_EXTENSION = '.tar.gz';

/**
 * Packs a snapshot directory into a deterministic archive.
 *
 * The container is a ustar tar, gzipped. A zip was the obvious choice and is the
 * wrong one: the zip format stores a DOS timestamp, and every JavaScript zip
 * writer derives it with `Date` methods that read the local timezone, so the
 * same snapshot packed in Denver and in Berlin produces different bytes. Tar
 * headers are fields this writer fills in itself, and every one of them here is
 * a constant.
 *
 * @param snapshotDir - Directory to pack.
 * @returns The archive bytes and their digest.
 * @throws Error when a path is too long for a ustar header.
 */
export function packSnapshot(snapshotDir: string): { bytes: Uint8Array; digest: Digest } {
  const files = listFiles(snapshotDir)
    .map((path) => ({
      name: relative(snapshotDir, path).split('\\').join('/'),
      body: new Uint8Array(readFileSync(path)),
    }))
    .sort((a, b) => compareCodeUnits(a.name, b.name));

  const chunks: Uint8Array[] = [];
  for (const file of files) {
    chunks.push(tarHeader(file.name, file.body.length), file.body, padding(file.body.length));
  }
  chunks.push(new Uint8Array(BLOCK * 2));

  const bytes = gzipSync(concat(chunks), { level: 9, mtime: 0 });
  return { bytes, digest: digest(bytes) };
}

/**
 * Unpacks a snapshot archive into a directory.
 *
 * @param bytes - The archive.
 * @param outDir - Directory to write into.
 * @param origin - Where the archive came from, used in error messages.
 * @returns The number of files written.
 * @throws Error when the archive does not decode, or names a path outside outDir.
 */
export function unpackSnapshot(bytes: Uint8Array, outDir: string, origin: string): number {
  let tar: Uint8Array;
  try {
    tar = gunzipSync(bytes);
  } catch (error) {
    throw new Error(
      `unpackSnapshot: ${origin} did not decode as a gzip archive; the store may be serving an error page with a 200 status`,
      { cause: error },
    );
  }

  let offset = 0;
  let written = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    const name = readString(header, 0, NAME_LIMIT);
    if (name === '') break;

    const size = readOctal(header, 124, 12);
    const start = offset + BLOCK;
    if (start + size > tar.length) {
      throw new Error(
        `unpackSnapshot: ${origin} claims ${String(size)} bytes for ${JSON.stringify(name)} and the archive ends first; it is truncated`,
      );
    }

    const segments = name.split('/').filter((part) => part !== '' && part !== '.' && part !== '..');
    if (segments.length > 0) {
      const target = join(outDir, ...segments);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, tar.subarray(start, start + size));
      written += 1;
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return written;
}

function tarHeader(name: string, size: number): Uint8Array {
  if (encoder.encode(name).length > NAME_LIMIT) {
    throw new Error(
      `packSnapshot: ${JSON.stringify(name)} is longer than the ${String(NAME_LIMIT)} bytes a ustar header holds; shorten the snapshot layout rather than switching to an extended header format`,
    );
  }

  const header = new Uint8Array(BLOCK);
  writeString(header, 0, name, NAME_LIMIT);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.set(encoder.encode('        '), 148);
  header[156] = 0x30;
  writeString(header, 257, 'ustar', 6);
  header.set(encoder.encode('00'), 263);

  let sum = 0;
  for (const byte of header) sum += byte;
  writeOctal(header, 148, 7, sum);
  header[154] = 0x20;
  return header;
}

function padding(size: number): Uint8Array {
  return new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK);
}

function writeString(target: Uint8Array, offset: number, value: string, length: number): void {
  target.set(encoder.encode(value).subarray(0, length), offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0');
  target.set(encoder.encode(text).subarray(0, length - 1), offset);
}

function readString(source: Uint8Array, offset: number, length: number): string {
  const slice = source.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end)).trim();
}

function readOctal(source: Uint8Array, offset: number, length: number): number {
  const text = readString(source, offset, length).replace(/\0/g, '').trim();
  const value = Number.parseInt(text === '' ? '0' : text, 8);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort(compareCodeUnits)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}
