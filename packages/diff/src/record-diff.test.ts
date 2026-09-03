import { describe, expect, it } from 'vitest';

import { diffJson } from './record-diff.js';

const paths = (before: Parameters<typeof diffJson>[0], after: Parameters<typeof diffJson>[1]) =>
  diffJson(before, after).map((change) => change.path);

describe('diffJson', () => {
  it('finds nothing when the two values canonicalize the same', () => {
    expect(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toStrictEqual([]);
    expect(diffJson('x', 'x')).toStrictEqual([]);
  });

  it('names the field that changed, not the document', () => {
    expect(diffJson({ a: 1, b: 2 }, { a: 1, b: 3 })).toStrictEqual([
      { path: '/b', before: '2', after: '3' },
    ]);
  });

  it('reports an added field with a null before and a removed one with a null after', () => {
    expect(diffJson({ a: 1 }, { a: 1, b: 2 })).toStrictEqual([
      { path: '/b', before: null, after: '2' },
    ]);
    expect(diffJson({ a: 1, b: 2 }, { a: 1 })).toStrictEqual([
      { path: '/b', before: '2', after: null },
    ]);
  });

  it('walks nested objects and escapes JSON Pointer segments', () => {
    expect(paths({ outer: { 'a/b': 1 } }, { outer: { 'a/b': 2 } })).toStrictEqual(['/outer/a~1b']);
    expect(paths({ 'x~y': 1 }, { 'x~y': 2 })).toStrictEqual(['/x~0y']);
  });

  it('walks arrays of the same length index by index', () => {
    expect(paths({ list: [1, 2, 3] }, { list: [1, 9, 3] })).toStrictEqual(['/list/1']);
    expect(paths([{ a: 1 }], [{ a: 2 }])).toStrictEqual(['/0/a']);
  });

  it('reports an array whole when its length changed', () => {
    expect(diffJson({ list: [1, 2] }, { list: [1, 2, 3] })).toStrictEqual([
      { path: '/list', before: '[1,2]', after: '[1,2,3]' },
    ]);
  });

  it('reports a type change at the field, not inside it', () => {
    expect(diffJson({ a: { b: 1 } }, { a: [1] })).toStrictEqual([
      { path: '/a', before: '{"b":1}', after: '[1]' },
    ]);
    expect(diffJson({ a: 1 }, { a: null })).toStrictEqual([
      { path: '/a', before: '1', after: 'null' },
    ]);
  });

  it('orders changes by path so the report reads the same every time', () => {
    expect(paths({ z: 1, a: 1, m: 1 }, { z: 2, a: 2, m: 2 })).toStrictEqual(['/a', '/m', '/z']);
  });

  it('reports a change at the root when the whole value is replaced', () => {
    expect(diffJson('before', 'after')).toStrictEqual([
      { path: '', before: '"before"', after: '"after"' },
    ]);
  });

  it('shows an OSV withdrawal and a rescore as separate fields', () => {
    const before = {
      id: 'GHSA-x',
      modified: '2025-01-01T00:00:00Z',
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L' }],
    };
    const after = {
      id: 'GHSA-x',
      modified: '2025-06-01T00:00:00Z',
      withdrawn: '2025-06-01T00:00:00Z',
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:L/AC:H' }],
    };
    expect(paths(before, after)).toStrictEqual(['/modified', '/severity/0/score', '/withdrawn']);
  });
});
