import { describe, expect, it } from 'vitest';

import { compareGoVersion, parseGoVersion, stripGoPrefix } from './go-version.js';

const sign = (value: number): number => (value === 0 ? 0 : value < 0 ? -1 : 1);

describe('parseGoVersion', () => {
  it('reads both the go.sum spelling and the OSV spelling', () => {
    expect(parseGoVersion('v1.2.3')).toStrictEqual(parseGoVersion('1.2.3'));
    expect(stripGoPrefix('v1.2.3')).toBe('1.2.3');
    expect(stripGoPrefix('1.2.3')).toBe('1.2.3');
  });

  it('fills in an omitted minor and patch with zero', () => {
    expect(parseGoVersion('v1')).toStrictEqual({
      major: '1',
      minor: '0',
      patch: '0',
      prerelease: [],
      build: [],
    });
    expect(parseGoVersion('v1.2')?.patch).toBe('0');
  });

  it('reads a pseudo-version as an ordinary prerelease', () => {
    expect(parseGoVersion('v0.0.0-20191109021931-daa7c04131f5')?.prerelease).toStrictEqual([
      '20191109021931-daa7c04131f5',
    ]);
  });

  it('reads the incompatible marker as build metadata', () => {
    expect(parseGoVersion('v2.0.0+incompatible')?.build).toStrictEqual(['incompatible']);
  });

  it('reads components, prerelease numbers, and build metadata of any length', () => {
    expect(parseGoVersion('v11.22.333')).toMatchObject({
      major: '11',
      minor: '22',
      patch: '333',
    });
    expect(parseGoVersion('v1.0.0-rc.1234')?.prerelease).toStrictEqual(['rc', '1234']);
    expect(parseGoVersion('v1.0.0-alpha1.beta2')?.prerelease).toStrictEqual(['alpha1', 'beta2']);
    expect(parseGoVersion('v1.0.0+build.1234')?.build).toStrictEqual(['build', '1234']);
  });

  it('rejects leading zeros and empty prereleases', () => {
    for (const value of [
      'v01.2.3',
      'v1.02.3',
      'v1.2.03',
      'v1.2.3-',
      'v1.2.3+',
      'v',
      '',
      'latest',
    ]) {
      expect(parseGoVersion(value)).toBeNull();
    }
  });
});

describe('compareGoVersion', () => {
  it('orders by major, minor, then patch', () => {
    expect(sign(compareGoVersion('v1.9.0', 'v1.10.0'))).toBe(-1);
    expect(sign(compareGoVersion('v2.0.0', 'v1.99.99'))).toBe(1);
  });

  it('treats an omitted component as zero', () => {
    expect(compareGoVersion('v1', 'v1.0.0')).toBe(0);
    expect(compareGoVersion('v1.2', 'v1.2.0')).toBe(0);
  });

  it('puts a pseudo-version below the release it precedes', () => {
    expect(sign(compareGoVersion('v1.2.3-0.20200101000000-abcdef123456', 'v1.2.3'))).toBe(-1);
  });

  it('orders two pseudo-versions by their timestamps', () => {
    expect(
      sign(
        compareGoVersion(
          'v0.0.0-20191109021931-daa7c04131f5',
          'v0.0.0-20210226172049-e18ecbb05110',
        ),
      ),
    ).toBe(-1);
  });

  it('ignores build metadata, so +incompatible does not change the order', () => {
    expect(compareGoVersion('v2.0.0+incompatible', 'v2.0.0')).toBe(0);
    expect(compareGoVersion('v1.0.0+a', 'v1.0.0+b')).toBe(0);
  });

  it('puts a numeric prerelease identifier below an alphanumeric one', () => {
    expect(sign(compareGoVersion('v1.0.0-1', 'v1.0.0-alpha'))).toBe(-1);
    expect(sign(compareGoVersion('v1.0.0-2', 'v1.0.0-10'))).toBe(-1);
  });

  it('puts a long numeric identifier below a short alphanumeric one', () => {
    expect(sign(compareGoVersion('v1.0.0-10', 'v1.0.0-a'))).toBe(-1);
    expect(sign(compareGoVersion('v1.0.0-a', 'v1.0.0-10'))).toBe(1);
  });

  it('puts a shorter prerelease below a longer one that shares its prefix', () => {
    expect(sign(compareGoVersion('v1.0.0-rc', 'v1.0.0-rc.1'))).toBe(-1);
  });

  it('treats the two spellings of one version as equal', () => {
    expect(compareGoVersion('v1.0.0', '1.0.0')).toBe(0);
    expect(compareGoVersion('v0.22.0', '0.22.0')).toBe(0);
  });

  it('names the offending version in both argument positions', () => {
    expect(() => compareGoVersion('v1.0.0-', 'v1.0.0')).toThrow(
      /"v1\.0\.0-" is not a Go module version/,
    );
    expect(() => compareGoVersion('v1.0.0', 'master')).toThrow(
      /"master" is not a Go module version/,
    );
  });
});
