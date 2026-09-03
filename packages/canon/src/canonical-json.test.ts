import { describe, expect, it } from 'vitest';

import { canonicalBytes, canonicalJson } from './canonical-json.js';
import type { JsonValue } from './json-value.js';

const SI = String.fromCharCode(0x0f);
const LF = String.fromCharCode(0x0a);
const CR = String.fromCharCode(0x0d);
const PAD = String.fromCharCode(0x80);
const DEL = String.fromCharCode(0x7f);

/** Casts a deliberately invalid value so the failure paths can be exercised. */
function invalid(value: unknown): JsonValue {
  // The whole point of these cases is that the value is outside JsonValue.
  return value as JsonValue;
}

describe('canonicalJson', () => {
  it('serializes the RFC 8785 sample document', () => {
    const sample = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: `\u20ac$${SI}${LF}A'B"\\\\"/`,
      literals: [null, true, false],
    };
    expect(canonicalJson(sample)).toBe(
      '{"literals":[null,true,false],' +
        '"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts object keys by UTF-16 code unit, not by code point or collation', () => {
    const keys = { '\u20ac': 1, '\ud83d\ude02': 2, '\u00f6': 3, '1': 4, '</script>': 5 };
    expect(canonicalJson(keys)).toBe(
      '{"1":4,"</script>":5,"\u00f6":3,"\u20ac":1,"\ud83d\ude02":2}',
    );
  });

  it('orders control character keys ahead of printable ones', () => {
    const document: JsonValue = { [CR]: 'cr', [LF]: 'lf', [PAD]: `control${DEL}` };
    expect(canonicalJson(document)).toBe(`{"\\n":"lf","\\r":"cr","${PAD}":"control${DEL}"}`);
  });

  it('normalizes keys to NFC before sorting, which can reorder them', () => {
    // U+FB33 decomposes under NFC to U+05D3 U+05BC and does not recompose,
    // so the key sorts where the dalet sorts rather than in the presentation
    // form block. This is the one place dumpscan diverges from bare JCS.
    const document = { '\ufb33': 'dalet', '\u00f6': 'o-umlaut', '\u20ac': 'euro' };
    expect(canonicalJson(document)).toBe(
      '{"\u00f6":"o-umlaut","\u05d3\u05bc":"dalet","\u20ac":"euro"}',
    );
  });

  it('normalizes string values to NFC', () => {
    expect(canonicalJson('e\u0301')).toBe('"\u00e9"');
    expect(canonicalJson({ k: 'A\u030a' })).toBe('{"k":"\u00c5"}');
  });

  it('escapes lone surrogates rather than emitting invalid UTF-8', () => {
    expect(canonicalJson('a\ud800b')).toBe('"a\\ud800b"');
    expect(canonicalJson('a\udc00b')).toBe('"a\\udc00b"');
  });

  it('serializes numbers in the ECMAScript form', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [-0, '0'],
      [100, '100'],
      [-1.5, '-1.5'],
      [1e21, '1e+21'],
      [1e-7, '1e-7'],
      [5e-324, '5e-324'],
      [1.7976931348623157e308, '1.7976931348623157e+308'],
    ];
    for (const [input, expected] of cases) {
      expect(canonicalJson(input)).toBe(expected);
    }
  });

  it('emits no whitespace and preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson({ b: [{ a: true }], a: false })).toBe('{"a":false,"b":[{"a":true}]}');
  });

  it('encodes canonical bytes as UTF-8', () => {
    expect([...canonicalBytes('\u20ac')]).toStrictEqual([0x22, 0xe2, 0x82, 0xac, 0x22]);
  });
});

describe('canonicalJson failure modes', () => {
  it('names the path of an undefined object property', () => {
    expect(() => canonicalJson(invalid({ a: { b: undefined } }))).toThrow(
      /property "b" at \/a is undefined/,
    );
  });

  it('names the path of an undefined array element', () => {
    expect(() => canonicalJson(invalid({ list: [1, undefined] }))).toThrow(
      /element 1 of the array at \/list is undefined/,
    );
  });

  it('escapes JSON Pointer segments in the reported path', () => {
    expect(() => canonicalJson(invalid({ 'a/b~c': { d: undefined } }))).toThrow(
      /at \/a~1b~0c is undefined/,
    );
  });

  it('rejects values that are not JSON at all', () => {
    expect(() => canonicalJson(invalid(undefined))).toThrow(
      /at the document root has type undefined/,
    );
    expect(() => canonicalJson(invalid(10n))).toThrow(/has type bigint/);
    expect(() => canonicalJson(invalid([() => 1]))).toThrow(/at \/0 has type function/);
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/at the document root is NaN/);
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow(/at \/x is Infinity/);
    expect(() => canonicalJson([Number.NEGATIVE_INFINITY])).toThrow(/at \/0 is -Infinity/);
  });

  it('rejects keys that collide only after NFC normalization', () => {
    const collision: Record<string, number> = { '\u00e9': 1 };
    collision['e\u0301'] = 2;
    expect(() => canonicalJson(collision)).toThrow(/both appear at the document root/);
  });

  it('rejects cycles through objects and through arrays', () => {
    const object: Record<string, unknown> = { name: 'loop' };
    object['self'] = object;
    expect(() => canonicalJson(invalid(object))).toThrow(/at \/self contains a cycle/);

    const array: unknown[] = [1];
    array.push(array);
    expect(() => canonicalJson(invalid(array))).toThrow(/at \/1 contains a cycle/);
  });

  it('accepts the same value appearing twice without calling it a cycle', () => {
    const shared = { a: 1 };
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });
});
