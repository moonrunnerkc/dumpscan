import { compareCodeUnits } from './compare.js';
import { isJsonArray } from './json-value.js';
import type { JsonArray, JsonObject, JsonValue } from './json-value.js';
import { normalizeNfc } from './normalize.js';

const encoder = new TextEncoder();

/**
 * Serializes a value to RFC 8785 (JCS) canonical JSON.
 *
 * Object keys are NFC-normalized and then sorted by UTF-16 code unit. Strings
 * are NFC-normalized. Numbers use the ECMAScript number-to-string form. No
 * whitespace is emitted.
 *
 * @param value - The value to serialize.
 * @returns Canonical JSON text.
 * @throws Error when the value contains `undefined`, a non-finite number, a
 * duplicate key after NFC normalization, or a cycle. Each message names the
 * JSON Pointer path of the offending node.
 */
export function canonicalJson(value: JsonValue): string {
  const out: string[] = [];
  write(value, out, '', new Set<object>());
  return out.join('');
}

/**
 * Serializes a value to canonical JSON and encodes it as UTF-8.
 *
 * @param value - The value to serialize.
 * @returns The canonical bytes that get hashed.
 * @throws Error under the same conditions as {@link canonicalJson}.
 */
export function canonicalBytes(value: JsonValue): Uint8Array {
  return encoder.encode(canonicalJson(value));
}

function write(value: JsonValue, out: string[], path: string, seen: Set<object>): void {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      out.push(writeNumber(value, path));
      return;
    case 'string':
      out.push(JSON.stringify(normalizeNfc(value)));
      return;
    case 'object':
      writeComposite(value, out, path, seen);
      return;
    default:
      throw new Error(
        `canonicalJson: value at ${describe(path)} has type ${typeof value}, which is not JSON; convert it to a string, number, boolean, array, object, or null before hashing`,
      );
  }
}

function writeComposite(
  value: JsonArray | JsonObject,
  out: string[],
  path: string,
  seen: Set<object>,
): void {
  if (seen.has(value)) {
    throw new Error(
      `canonicalJson: value at ${describe(path)} contains a cycle; canonical JSON has no representation for one, so break the cycle before hashing`,
    );
  }
  seen.add(value);
  if (isJsonArray(value)) writeArray(value, out, path, seen);
  else writeObject(value, out, path, seen);
  seen.delete(value);
}

function writeArray(value: JsonArray, out: string[], path: string, seen: Set<object>): void {
  out.push('[');
  for (let i = 0; i < value.length; i += 1) {
    if (i > 0) out.push(',');
    const element = value[i];
    if (element === undefined) {
      throw new Error(
        `canonicalJson: element ${i} of the array at ${describe(path)} is undefined; canonical JSON has no representation for undefined, so use null or omit the element`,
      );
    }
    write(element, out, `${path}/${i}`, seen);
  }
  out.push(']');
}

function writeObject(value: JsonObject, out: string[], path: string, seen: Set<object>): void {
  const keys: string[] = [];
  const normalized = new Map<string, JsonValue>();
  for (const rawKey of Object.keys(value)) {
    const key = normalizeNfc(rawKey);
    const member = value[rawKey];
    if (member === undefined) {
      throw new Error(
        `canonicalJson: property ${JSON.stringify(rawKey)} at ${describe(path)} is undefined; canonical JSON has no representation for undefined, so omit the property instead of setting it`,
      );
    }
    if (normalized.has(key)) {
      throw new Error(
        `canonicalJson: properties ${JSON.stringify(rawKey)} and its NFC equivalent both appear at ${describe(path)}; normalize the keys upstream so exactly one survives`,
      );
    }
    normalized.set(key, member);
    keys.push(key);
  }
  keys.sort(compareCodeUnits);

  out.push('{');
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i] as string;
    if (i > 0) out.push(',');
    out.push(JSON.stringify(key), ':');
    write(normalized.get(key) as JsonValue, out, `${path}/${escapePointer(key)}`, seen);
  }
  out.push('}');
}

function writeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `canonicalJson: number at ${describe(path)} is ${String(value)}; JSON has no representation for it, so use null or a string`,
    );
  }
  return JSON.stringify(value);
}

function escapePointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

function describe(path: string): string {
  return path === '' ? 'the document root' : path;
}
