import type { JsonObject, JsonValue } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import { describeErrors, validate } from './validate.js';

const messages = (schema: JsonObject, value: Parameters<typeof validate>[1]): string[] =>
  validate(schema, value).map((error) => `${error.path}|${error.message}`);

describe('validate types', () => {
  it('accepts each declared type and rejects the rest', () => {
    const cases: [string, unknown][] = [
      ['object', {}],
      ['array', []],
      ['string', 'x'],
      ['integer', 1],
      ['number', 1.5],
      ['boolean', true],
      ['null', null],
    ];
    for (const [type, value] of cases) {
      expect(validate({ type }, value as JsonValue)).toStrictEqual([]);
      expect(validate({ type }, 'not-a-match').length + (type === 'string' ? 1 : 0)).toBe(1);
    }
  });

  it('does not accept a float where an integer is declared', () => {
    expect(messages({ type: 'integer' }, 1.5)).toStrictEqual(['|expected integer, found number']);
  });

  it('accepts either member of a type union', () => {
    const schema: JsonObject = { type: ['string', 'null'] };
    expect(validate(schema, 'x')).toStrictEqual([]);
    expect(validate(schema, null)).toStrictEqual([]);
    expect(messages(schema, 1)).toStrictEqual(['|expected string or null, found number']);
  });

  it('names arrays, objects, and null distinctly in the message', () => {
    expect(messages({ type: 'string' }, [])).toStrictEqual(['|expected string, found array']);
    expect(messages({ type: 'string' }, {})).toStrictEqual(['|expected string, found object']);
    expect(messages({ type: 'string' }, null)).toStrictEqual(['|expected string, found null']);
  });

  it('refuses a schema that declares a type that is not one', () => {
    expect(() => validate({ type: 'digest' }, 'x')).toThrow(/is not a JSON Schema type/);
    expect(() => validate({ type: 7 }, 'x')).toThrow(/neither a type name nor a list of them/);
  });

  it('refuses a schema keyword it does not implement', () => {
    expect(() => validate({ anyOf: [] }, 'x')).toThrow(/uses the keyword "anyOf"/);
    expect(() => validate({ type: 'object', properties: { a: { $ref: '#' } } }, { a: 1 })).toThrow(
      /schema at \/a uses the keyword "\$ref"/,
    );
  });
});

describe('validate constraints', () => {
  it('checks const and enum', () => {
    expect(validate({ const: 'a' }, 'a')).toStrictEqual([]);
    expect(messages({ const: 'a' }, 'b')).toStrictEqual(['|expected the constant "a"']);
    expect(validate({ enum: ['a', 'b'] }, 'b')).toStrictEqual([]);
    expect(messages({ enum: ['a', 'b'] }, 'c')).toStrictEqual(['|expected one of ["a","b"]']);
  });

  it('checks patterns only against strings', () => {
    expect(validate({ pattern: '^a+$' }, 'aaa')).toStrictEqual([]);
    expect(messages({ pattern: '^a+$' }, 'b')).toStrictEqual(['|"b" does not match ^a+$']);
    expect(validate({ pattern: '^a+$' }, 1)).toStrictEqual([]);
  });

  it('checks minimum only against numbers', () => {
    expect(validate({ minimum: 0 }, 0)).toStrictEqual([]);
    expect(messages({ minimum: 0 }, -1)).toStrictEqual(['|-1 is below the minimum 0']);
    expect(validate({ minimum: 0 }, 'x')).toStrictEqual([]);
  });

  it('checks minItems and uniqueItems', () => {
    expect(messages({ type: 'array', minItems: 2 }, [1])).toStrictEqual([
      '|expected at least 2 items, found 1',
    ]);
    expect(messages({ type: 'array', uniqueItems: true }, [1, 1])).toStrictEqual([
      '|expected every item to be distinct',
    ]);
    expect(validate({ type: 'array', uniqueItems: true }, [1, 2])).toStrictEqual([]);
  });

  it('checks every item against the items schema', () => {
    expect(messages({ type: 'array', items: { type: 'string' } }, ['a', 1, 'c'])).toStrictEqual([
      '/1|expected string, found number',
    ]);
  });
});

describe('validate objects', () => {
  const schema: JsonObject = {
    type: 'object',
    required: ['a'],
    additionalProperties: false,
    properties: { a: { type: 'string' }, b: { type: 'integer' } },
  };

  it('reports a missing required property', () => {
    expect(messages(schema, {})).toStrictEqual(['|missing required property "a"']);
  });

  it('reports a property that is not in the schema', () => {
    expect(messages(schema, { a: 'x', c: 1 })).toStrictEqual(['|unexpected property "c"']);
  });

  it('allows extra properties when additionalProperties is not false', () => {
    expect(
      validate({ type: 'object', properties: { a: { type: 'string' } } }, { a: 'x', c: 1 }),
    ).toStrictEqual([]);
  });

  it('reports the JSON Pointer path of a nested failure', () => {
    const nested: JsonObject = {
      type: 'object',
      properties: { outer: { type: 'object', properties: { 'a/b': { type: 'string' } } } },
    };
    expect(messages(nested, { outer: { 'a/b': 1 } })).toStrictEqual([
      '/outer/a~1b|expected string, found number',
    ]);
  });

  it('collects every failure rather than stopping at the first', () => {
    expect(messages(schema, { b: 'x', c: 1 })).toStrictEqual([
      '|missing required property "a"',
      '/b|expected integer, found string',
      '|unexpected property "c"',
    ]);
  });
});

describe('describeErrors', () => {
  it('names the root and joins the rest', () => {
    expect(describeErrors(validate({ type: 'string' }, 1))).toBe(
      '(root): expected string, found number',
    );
    expect(describeErrors(validate({ type: 'array', items: { type: 'string' } }, [1, 2]))).toBe(
      '/0: expected string, found number; /1: expected string, found number',
    );
  });

  it('renders nothing for no errors', () => {
    expect(describeErrors([])).toBe('');
  });
});
