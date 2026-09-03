import { describe, expect, it } from 'vitest';

import {
  buildManifest,
  comparePackages,
  INPUT_MANIFEST_VERSION,
  inputDigest,
  inputPackage,
  manifestToJson,
  normalizePackages,
  ROOT_WORKSPACE,
} from './manifest.js';
import type { InputPackage } from './manifest.js';

const DIGEST = `sha256:${'0'.repeat(64)}` as const;

function manifest(packages: InputPackage[], unresolved: string[] = []) {
  return buildManifest({
    format: 'test',
    lockfileDigest: DIGEST,
    workspaceRoot: ROOT_WORKSPACE,
    overApproximated: false,
    packages,
    unresolved,
  });
}

describe('inputPackage', () => {
  it('trims and NFC normalizes the name and version, and derives the purl', () => {
    const entry = inputPackage('npm', '  Cafe\u0301  ', ' 1.0.0 ');
    expect(entry.name).toBe('Caf\u00e9');
    expect(entry.version).toBe('1.0.0');
    expect(entry.purl).toBe('pkg:npm/caf%C3%A9@1.0.0');
  });
});

describe('comparePackages', () => {
  it('orders by ecosystem, then name, then version', () => {
    const npm = inputPackage('npm', 'a', '1.0.0');
    const pypi = inputPackage('PyPI', 'a', '1.0.0');
    expect(comparePackages(pypi, npm)).toBeLessThan(0);
    expect(
      comparePackages(inputPackage('npm', 'a', '1.0.0'), inputPackage('npm', 'b', '1.0.0')),
    ).toBeLessThan(0);
    expect(
      comparePackages(inputPackage('npm', 'a', '1.0.0'), inputPackage('npm', 'a', '1.0.1')),
    ).toBeLessThan(0);
    expect(comparePackages(npm, npm)).toBe(0);
  });

  it('orders by code unit, not by collation', () => {
    expect(
      comparePackages(inputPackage('npm', 'B', '1.0.0'), inputPackage('npm', 'a', '1.0.0')),
    ).toBeLessThan(0);
  });
});

describe('normalizePackages', () => {
  it('deduplicates identical tuples and sorts the rest', () => {
    const sorted = normalizePackages([
      inputPackage('npm', 'b', '1.0.0'),
      inputPackage('npm', 'a', '2.0.0'),
      inputPackage('npm', 'b', '1.0.0'),
    ]);
    expect(sorted.map((entry) => `${entry.name}@${entry.version}`)).toStrictEqual([
      'a@2.0.0',
      'b@1.0.0',
    ]);
  });

  it('keeps two versions of the same package', () => {
    const sorted = normalizePackages([
      inputPackage('npm', 'a', '2.0.0'),
      inputPackage('npm', 'a', '1.0.0'),
    ]);
    expect(sorted).toHaveLength(2);
  });
});

describe('buildManifest', () => {
  it('stamps the manifest version and sorts both lists', () => {
    const built = manifest(
      [inputPackage('npm', 'b', '1.0.0'), inputPackage('npm', 'a', '1.0.0')],
      ['zeta', 'alpha', 'zeta'],
    );
    expect(built.manifestVersion).toBe(INPUT_MANIFEST_VERSION);
    expect(built.packages.map((entry) => entry.name)).toStrictEqual(['a', 'b']);
    expect(built.unresolved).toStrictEqual(['alpha', 'zeta']);
  });
});

describe('inputDigest', () => {
  it('does not depend on the order the parser found the packages in', () => {
    const a = manifest([inputPackage('npm', 'a', '1.0.0'), inputPackage('npm', 'b', '1.0.0')]);
    const b = manifest([inputPackage('npm', 'b', '1.0.0'), inputPackage('npm', 'a', '1.0.0')]);
    expect(inputDigest(a)).toBe(inputDigest(b));
  });

  it('moves when a resolved version moves', () => {
    const a = manifest([inputPackage('npm', 'a', '1.0.0')]);
    const b = manifest([inputPackage('npm', 'a', '1.0.1')]);
    expect(inputDigest(a)).not.toBe(inputDigest(b));
  });

  it('moves when a package becomes unresolved rather than dropped', () => {
    const a = manifest([inputPackage('npm', 'a', '1.0.0')]);
    const b = manifest([], ['a']);
    expect(inputDigest(a)).not.toBe(inputDigest(b));
    expect(inputDigest(b)).not.toBe(inputDigest(manifest([])));
  });

  it('moves when the over-approximation flag moves', () => {
    const base = manifest([inputPackage('Go', 'example.invalid/x', 'v1.0.0')]);
    const upper = buildManifest({
      format: 'test',
      lockfileDigest: DIGEST,
      workspaceRoot: ROOT_WORKSPACE,
      overApproximated: true,
      packages: [inputPackage('Go', 'example.invalid/x', 'v1.0.0')],
      unresolved: [],
    });
    expect(inputDigest(upper)).not.toBe(inputDigest(base));
  });

  it('moves when the workspace root moves, so two members never collide', () => {
    const root = manifest([inputPackage('npm', 'a', '1.0.0')]);
    const member = buildManifest({
      format: 'test',
      lockfileDigest: DIGEST,
      workspaceRoot: 'packages/api',
      overApproximated: false,
      packages: [inputPackage('npm', 'a', '1.0.0')],
      unresolved: [],
    });
    expect(inputDigest(member)).not.toBe(inputDigest(root));
  });
});

describe('manifestToJson', () => {
  it('renders exactly the fields that get hashed', () => {
    const json = manifestToJson(manifest([inputPackage('npm', 'a', '1.0.0')], ['b']));
    expect(Object.keys(json).sort()).toStrictEqual([
      'format',
      'lockfileDigest',
      'manifestVersion',
      'overApproximated',
      'packages',
      'unresolved',
      'workspaceRoot',
    ]);
  });
});
