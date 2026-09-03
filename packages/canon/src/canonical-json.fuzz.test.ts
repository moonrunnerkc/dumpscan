import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical-json.js';
import type { JsonObject, JsonValue } from './json-value.js';

/**
 * A second JCS implementation written against RFC 8785 directly, sharing no
 * code with the one under test. Key ordering walks UTF-16 code units by hand
 * instead of leaning on the relational operators, and string escaping uses an
 * explicit table instead of JSON.stringify. Those two are where real JCS
 * implementations diverge from each other.
 */
const ESCAPES = new Map<number, string>([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\'],
]);

function referenceEscape(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const escape = ESCAPES.get(code);
    if (escape !== undefined) {
      out += escape;
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        out += value.slice(i, i + 2);
        i += 1;
      } else {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += value.charAt(i);
    }
  }
  return `${out}"`;
}

function referenceOrder(a: string, b: string): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const left = a.charCodeAt(i);
    const right = b.charCodeAt(i);
    if (left !== right) return left - right;
  }
  return a.length - b.length;
}

function reference(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return referenceEscape(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(reference).join(',')}]`;

  const entries: [string, JsonValue][] = [];
  for (const [key, member] of Object.entries(value as JsonObject)) {
    entries.push([key.normalize('NFC'), member]);
  }
  entries.sort((a, b) => referenceOrder(a[0], b[0]));
  const body = entries.map(([key, member]) => `${referenceEscape(key)}:${reference(member)}`);
  return `{${body.join(',')}}`;
}

/** xorshift32, so a failing case is reproducible from the seed alone. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

const CHAR_POOL = [
  0x20, 0x21, 0x22, 0x2f, 0x5c, 0x7e, 0x00, 0x01, 0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x1f, 0x7f, 0x80,
  0x41, 0x61, 0x30, 0xe9, 0x65, 0x301, 0xf6, 0x5d3, 0x5bc, 0xfb33, 0x20ac, 0x212b, 0x2028, 0x2029,
  0xd800, 0xdc00, 0xd83d, 0xde02, 0xfeff,
];

const NUMBER_POOL = [
  0, -0, 1, -1, 0.5, -1.5, 100, 1e21, 1e-7, 5e-324, 1.7976931348623157e308, 333333333.33333329,
  2e-3, 1e-27, 9007199254740992, -9007199254740992, 3.141592653589793,
];

function pick<T>(random: () => number, pool: readonly T[]): T {
  return pool[Math.floor(random() * pool.length)] as T;
}

function randomString(random: () => number): string {
  const length = Math.floor(random() * 8);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(pick(random, CHAR_POOL));
  }
  return out;
}

function randomValue(random: () => number, depth: number): JsonValue {
  const roll = random();
  if (depth <= 0 || roll < 0.45) {
    if (roll < 0.1) return null;
    if (roll < 0.18) return random() < 0.5;
    if (roll < 0.32) return pick(random, NUMBER_POOL);
    return randomString(random);
  }
  const size = Math.floor(random() * 5);
  if (roll < 0.72) {
    const items: JsonValue[] = [];
    for (let i = 0; i < size; i += 1) items.push(randomValue(random, depth - 1));
    return items;
  }
  const object: Record<string, JsonValue> = {};
  for (let i = 0; i < size; i += 1) {
    object[randomString(random)] = randomValue(random, depth - 1);
  }
  return object;
}

const SEEDS = [1, 7, 13, 29, 61, 127, 257, 521, 1031, 2053];
const CASES_PER_SEED = 1000;

describe('canonicalJson differential fuzz', () => {
  it(`agrees with an independent JCS implementation on ${SEEDS.length * CASES_PER_SEED} values`, () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const random = makeRandom(seed);
      for (let i = 0; i < CASES_PER_SEED; i += 1) {
        const value = randomValue(random, 4);
        let actual: string;
        try {
          actual = canonicalJson(value);
        } catch (error) {
          // The only rejection the generator can produce is an NFC key
          // collision, which the reference implementation resolves silently.
          expect(String(error)).toMatch(/both appear at/);
          continue;
        }
        if (actual !== reference(value)) {
          throw new Error(
            `seed ${seed} case ${i} diverged\n  canon:     ${actual}\n  reference: ${reference(value)}`,
          );
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(SEEDS.length * CASES_PER_SEED * 0.95);
  });

  it('produces output that parses back to the normalized input', () => {
    const random = makeRandom(0xdecafbad);
    for (let i = 0; i < 2000; i += 1) {
      const value = randomValue(random, 4);
      let text: string;
      try {
        text = canonicalJson(value);
      } catch {
        continue;
      }
      expect(canonicalJson(JSON.parse(text) as JsonValue)).toBe(text);
    }
  });
});
