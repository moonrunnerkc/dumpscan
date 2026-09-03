import { describe, expect, it } from 'vitest';

import { compareParsedSemver, compareSemver, parseSemver } from './semver.js';
import type { SemverVersion } from './semver.js';

const sign = (value: number): number => (value === 0 ? 0 : value < 0 ? -1 : 1);

describe('parseSemver', () => {
  it('splits the five components', () => {
    expect(parseSemver('1.2.3-beta.11+exp.sha.5114f85')).toStrictEqual({
      major: '1',
      minor: '2',
      patch: '3',
      prerelease: ['beta', '11'],
      build: ['exp', 'sha', '5114f85'],
    });
  });

  it('reports absent prerelease and build as empty lists', () => {
    expect(parseSemver('0.0.0')).toStrictEqual({
      major: '0',
      minor: '0',
      patch: '0',
      prerelease: [],
      build: [],
    });
  });

  it('keeps components as strings so precision survives', () => {
    expect(parseSemver('9007199254740991.0.0')?.major).toBe('9007199254740991');
  });

  it('rejects a component above the safe integer range, as node-semver does', () => {
    expect(parseSemver('9007199254740992.0.0')).toBeNull();
    expect(parseSemver('1.9007199254740992.0')).toBeNull();
    expect(parseSemver('1.0.9007199254740992')).toBeNull();
  });

  it('rejects anything that is not strict SemVer', () => {
    for (const value of ['1', '1.0', 'v1.0.0', '01.0.0', '1.0.0-', '1.0.0+', '', ' 1.0.0']) {
      expect(parseSemver(value)).toBeNull();
    }
  });

  it('accepts hyphens and leading zero digits inside alphanumeric identifiers', () => {
    expect(parseSemver('1.0.0-x-y-z.--')?.prerelease).toStrictEqual(['x-y-z', '--']);
    expect(parseSemver('1.0.0-0A.is.legal')?.prerelease).toStrictEqual(['0A', 'is', 'legal']);
  });

  it('rejects a numeric prerelease identifier with a leading zero', () => {
    expect(parseSemver('1.0.0-01')).toBeNull();
  });

  it('accepts numeric identifiers of any length', () => {
    expect(parseSemver('1.0.0-123')?.prerelease).toStrictEqual(['123']);
    expect(parseSemver('1.0.0-beta.4567')?.prerelease).toStrictEqual(['beta', '4567']);
    expect(parseSemver('123.4567.89012')?.major).toBe('123');
  });

  it('accepts multi segment build metadata of any length', () => {
    expect(parseSemver('1.0.0+build.12345')?.build).toStrictEqual(['build', '12345']);
  });
});

describe('compareSemver', () => {
  it('orders by major, then minor, then patch', () => {
    expect(sign(compareSemver('1.0.0', '2.0.0'))).toBe(-1);
    expect(sign(compareSemver('1.1.0', '1.0.9'))).toBe(1);
    expect(sign(compareSemver('1.0.1', '1.0.2'))).toBe(-1);
  });

  it('puts a prerelease below the same version without one', () => {
    expect(sign(compareSemver('1.0.0-rc.1', '1.0.0'))).toBe(-1);
    expect(sign(compareSemver('1.0.0', '1.0.0-rc.1'))).toBe(1);
  });

  it('orders numeric prerelease identifiers numerically', () => {
    expect(sign(compareSemver('1.0.0-beta.2', '1.0.0-beta.11'))).toBe(-1);
  });

  it('puts a numeric identifier below an alphanumeric one', () => {
    expect(sign(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.0valid'))).toBe(-1);
  });

  it('puts a long numeric identifier below a short alphanumeric one', () => {
    // Comparing these as digit strings would put the two character 10 above the
    // one character a, which is the wrong answer and the wrong rule.
    expect(sign(compareSemver('1.0.0-10', '1.0.0-a'))).toBe(-1);
    expect(sign(compareSemver('1.0.0-a', '1.0.0-10'))).toBe(1);
  });

  it('orders alphanumeric identifiers by ASCII code unit', () => {
    expect(sign(compareSemver('1.0.0-0A.is.legal', '1.0.0-alpha'))).toBe(-1);
  });

  it('puts a shorter prerelease below a longer one that shares its prefix', () => {
    expect(sign(compareSemver('1.0.0-alpha', '1.0.0-alpha.1'))).toBe(-1);
    expect(sign(compareSemver('1.0.0-alpha.1', '1.0.0-alpha'))).toBe(1);
  });

  it('ignores build metadata entirely', () => {
    expect(compareSemver('1.0.0+a', '1.0.0+b')).toBe(0);
    expect(compareSemver('1.0.0', '1.0.0+build.1')).toBe(0);
    expect(compareSemver('1.0.0-rc.1+a', '1.0.0-rc.1+b')).toBe(0);
  });

  it('names the offending version and says what to do about it', () => {
    expect(() => compareSemver('1.0', '1.0.0')).toThrow(/"1\.0" is not a SemVer 2\.0\.0 version/);
    expect(() => compareSemver('1.0.0', 'latest')).toThrow(/"latest" is not a SemVer/);
  });
});

describe('compareParsedSemver', () => {
  it('takes already parsed versions so a caller can parse once', () => {
    const a = parseSemver('1.2.3') as SemverVersion;
    const b = parseSemver('1.2.4') as SemverVersion;
    expect(sign(compareParsedSemver(a, b))).toBe(-1);
    expect(compareParsedSemver(a, a)).toBe(0);
  });
});
