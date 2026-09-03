import { describe, expect, it } from 'vitest';

import { purlFor } from './purl.js';

describe('purlFor npm', () => {
  it('lowercases the name', () => {
    expect(purlFor('npm', 'CheeseParser', '4.17.21')).toBe('pkg:npm/cheeseparser@4.17.21');
  });

  it('makes the scope a namespace and percent encodes its at sign', () => {
    expect(purlFor('npm', '@Sample/Widget-Dep', '1.4.7')).toBe(
      'pkg:npm/%40sample/widget-dep@1.4.7',
    );
  });

  it('treats a bare at sign with no slash as a plain name', () => {
    expect(purlFor('npm', '@weird', '1.0.0')).toBe('pkg:npm/%40weird@1.0.0');
  });
});

describe('purlFor PyPI', () => {
  it('normalizes the name per PEP 503', () => {
    expect(purlFor('PyPI', 'Sample_Client', '2.30.0')).toBe('pkg:pypi/sample-client@2.30.0');
    expect(purlFor('PyPI', 'sample.client', '2.30.0')).toBe('pkg:pypi/sample-client@2.30.0');
  });

  it('leaves the version alone, including an epoch and a local segment', () => {
    expect(purlFor('PyPI', 'thing', '1!2.0+ubuntu.1')).toBe('pkg:pypi/thing@1!2.0%2Bubuntu.1');
  });
});

describe('purlFor crates.io', () => {
  it('uses the cargo type and keeps the crate name as written', () => {
    expect(purlFor('crates.io', 'sample_crate', '0.3.36')).toBe('pkg:cargo/sample_crate@0.3.36');
  });
});

describe('purlFor Go', () => {
  it('splits the module path into namespace segments and case folds it', () => {
    expect(purlFor('Go', 'example.invalid/x/Net', 'v0.23.0')).toBe(
      'pkg:golang/example.invalid/x/net@v0.23.0',
    );
  });

  it('handles a single segment module path', () => {
    expect(purlFor('Go', 'stdlib', 'v1.22.0')).toBe('pkg:golang/stdlib@v1.22.0');
  });

  it('drops empty path segments rather than emitting a double slash', () => {
    expect(purlFor('Go', 'example.invalid//x/', 'v1.0.0')).toBe(
      'pkg:golang/example.invalid/x@v1.0.0',
    );
  });
});

describe('purlFor Maven', () => {
  it('splits groupId and artifactId and preserves case', () => {
    expect(purlFor('Maven', 'org.example:Sample-Core', '2.16.0')).toBe(
      'pkg:maven/org.example/Sample-Core@2.16.0',
    );
  });

  it('says what is missing when the coordinate has no colon', () => {
    expect(() => purlFor('Maven', 'sample-core', '1.0.0')).toThrow(
      /has no colon; dumpscan needs groupId:artifactId/,
    );
  });
});

describe('purlFor encoding', () => {
  it('trims and NFC normalizes before percent encoding, so both spellings agree', () => {
    expect(purlFor('PyPI', '  Cafe\u0301  ', ' 1.0.0 ')).toBe('pkg:pypi/caf%C3%A9@1.0.0');
    expect(purlFor('PyPI', 'Caf\u00e9', '1.0.0')).toBe('pkg:pypi/caf%C3%A9@1.0.0');
  });

  it('percent encodes characters that would otherwise change the purl structure', () => {
    expect(purlFor('crates.io', 'a b', '1.0.0')).toBe('pkg:cargo/a%20b@1.0.0');
  });
});
