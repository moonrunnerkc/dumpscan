import { createHash } from 'node:crypto';

import { canonicalBytes } from './canonical-json.js';
import type { JsonValue } from './json-value.js';

/** A SHA-256 digest in the one textual form dumpscan uses anywhere. */
export type Digest = `sha256:${string}`;

const HEX = '0123456789abcdef';
const DIGEST_TEXT = /^sha256:[0-9a-f]{64}$/;

/**
 * Hashes bytes with SHA-256.
 *
 * @param bytes - The bytes to hash.
 * @returns The 32 byte digest.
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(bytes).digest());
}

/**
 * Renders bytes as lowercase hexadecimal.
 *
 * @param bytes - The bytes to render.
 * @returns Lowercase hex, two characters per byte.
 */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX.charAt(byte >> 4);
    out += HEX.charAt(byte & 0x0f);
  }
  return out;
}

/**
 * Parses lowercase hexadecimal into bytes.
 *
 * @param hex - An even-length lowercase hex string.
 * @returns The decoded bytes.
 * @throws Error when the string is not even-length lowercase hex.
 */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(
      `fromHex: ${JSON.stringify(hex)} has odd length ${hex.length}; hex input needs two characters per byte`,
    );
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const high = HEX.indexOf(hex[i * 2] as string);
    const low = HEX.indexOf(hex[i * 2 + 1] as string);
    if (high < 0 || low < 0) {
      throw new Error(
        `fromHex: ${JSON.stringify(hex)} contains a character that is not lowercase hex at offset ${i * 2}; dumpscan writes digests in lowercase only`,
      );
    }
    out[i] = high * 16 + low;
  }
  return out;
}

/**
 * Formats an already computed SHA-256 hash as a dumpscan digest string. This is
 * the only place in the codebase that builds the `sha256:` prefix.
 *
 * @param hash - A 32 byte SHA-256 hash.
 * @returns The digest string.
 * @throws Error when the hash is not 32 bytes.
 */
export function formatDigest(hash: Uint8Array): Digest {
  if (hash.length !== 32) {
    throw new Error(
      `formatDigest: expected a 32 byte SHA-256 hash, received ${hash.length} bytes; hash the value with sha256 before formatting it`,
    );
  }
  return `sha256:${toHex(hash)}`;
}

/**
 * Hashes bytes and formats the result as a dumpscan digest string.
 *
 * @param bytes - The bytes to hash.
 * @returns The digest string.
 */
export function digest(bytes: Uint8Array): Digest {
  return formatDigest(sha256(bytes));
}

/**
 * Canonicalizes a JSON value and hashes its canonical bytes.
 *
 * @param value - The value to hash.
 * @returns The digest of the RFC 8785 canonical form.
 * @throws Error when the value cannot be canonicalized.
 */
export function digestOfJson(value: JsonValue): Digest {
  return digest(canonicalBytes(value));
}

/**
 * Reports whether a string is a well formed dumpscan digest.
 *
 * @param text - Candidate text.
 * @returns True for `sha256:` followed by 64 lowercase hex characters.
 */
export function isDigest(text: string): text is Digest {
  return DIGEST_TEXT.test(text);
}

/**
 * Extracts the raw hash bytes from a dumpscan digest string.
 *
 * @param text - A digest string.
 * @returns The 32 byte hash.
 * @throws Error when the text is not a well formed digest.
 */
export function parseDigest(text: string): Uint8Array {
  if (!isDigest(text)) {
    throw new Error(
      `parseDigest: ${JSON.stringify(text)} is not a dumpscan digest; expected sha256: followed by 64 lowercase hex characters`,
    );
  }
  return fromHex(text.slice('sha256:'.length));
}
