import { describe, expect, it } from 'vitest';

import {
  baseEcosystem,
  ECOSYSTEMS,
  ecosystemSlug,
  isEcosystem,
  normalizePackageName,
} from './ecosystem.js';

describe('isEcosystem', () => {
  it('accepts the v1 ecosystems and nothing else', () => {
    for (const ecosystem of ECOSYSTEMS) expect(isEcosystem(ecosystem)).toBe(true);
    expect(isEcosystem('Debian')).toBe(false);
    expect(isEcosystem('NPM')).toBe(false);
  });
});

describe('baseEcosystem', () => {
  it('strips a distribution suffix', () => {
    expect(baseEcosystem('Alpine:v3.16')).toBe('Alpine');
    expect(baseEcosystem('Debian:12')).toBe('Debian');
  });

  it('leaves a suffix-free ecosystem alone', () => {
    expect(baseEcosystem('crates.io')).toBe('crates.io');
  });
});

describe('ecosystemSlug', () => {
  it('lowercases so the filename survives a case insensitive filesystem', () => {
    expect(ecosystemSlug('PyPI')).toBe('pypi');
    expect(ecosystemSlug('Maven')).toBe('maven');
    expect(ecosystemSlug('crates.io')).toBe('crates.io');
  });
});

describe('normalizePackageName', () => {
  it('lowercases npm names and keeps the scope', () => {
    expect(normalizePackageName('npm', '@Sample/Widget')).toBe('@sample/widget');
    expect(normalizePackageName('npm', 'lodash')).toBe('lodash');
  });

  it('applies PEP 503 normalization for PyPI', () => {
    expect(normalizePackageName('PyPI', 'Sample_Client')).toBe('sample-client');
    expect(normalizePackageName('PyPI', 'sample.client')).toBe('sample-client');
    expect(normalizePackageName('PyPI', 'SAMPLE---client')).toBe('sample-client');
    expect(normalizePackageName('PyPI', 'zope.interface')).toBe('zope-interface');
  });

  it('folds underscores for crates.io, matching the registry uniqueness rule', () => {
    expect(normalizePackageName('crates.io', 'sample_crate')).toBe('sample-crate');
    expect(normalizePackageName('crates.io', 'Sample-Crate')).toBe('sample-crate');
  });

  it('case folds Go module paths without touching the separators', () => {
    expect(normalizePackageName('Go', 'example.invalid/x/Net')).toBe('example.invalid/x/net');
    expect(normalizePackageName('Go', 'github.com/Foo/Bar/v2')).toBe('github.com/foo/bar/v2');
  });

  it('leaves Maven coordinates alone because they are case sensitive', () => {
    expect(normalizePackageName('Maven', 'org.example:Sample-Core')).toBe(
      'org.example:Sample-Core',
    );
  });

  it('trims surrounding whitespace and normalizes to NFC first', () => {
    expect(normalizePackageName('PyPI', '  Café  ')).toBe('café');
    expect(normalizePackageName('Maven', ' org.example:core ')).toBe('org.example:core');
  });

  it('is idempotent for every ecosystem', () => {
    for (const ecosystem of ECOSYSTEMS) {
      const once = normalizePackageName(ecosystem, 'Some_Name.Thing');
      expect(normalizePackageName(ecosystem, once)).toBe(once);
    }
  });
});
