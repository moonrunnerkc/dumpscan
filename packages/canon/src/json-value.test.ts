import { describe, expect, it } from 'vitest';

import { isJsonArray, isJsonObject, parseJson } from './json-value.js';

describe('parseJson', () => {
  it('parses JSON text into the canonicalizable model', () => {
    expect(parseJson('{"a":[1,null,true]}')).toStrictEqual({ a: [1, null, true] });
  });

  it('propagates the parser error for invalid text', () => {
    expect(() => parseJson('{')).toThrow(SyntaxError);
  });
});

describe('isJsonObject', () => {
  it('accepts plain objects only', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject('x')).toBe(false);
    expect(isJsonObject(1)).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
  });
});

describe('isJsonArray', () => {
  it('accepts arrays only', () => {
    expect(isJsonArray([])).toBe(true);
    expect(isJsonArray([1])).toBe(true);
    expect(isJsonArray({})).toBe(false);
    expect(isJsonArray(null)).toBe(false);
    expect(isJsonArray(undefined)).toBe(false);
  });
});
