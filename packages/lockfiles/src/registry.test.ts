import { describe, expect, it } from 'vitest';

import { closureFrom } from './closure.js';
import type { DependencyNode } from './closure.js';
import { basename, parseInput, UnpinnedLockfileError } from './parser.js';
import { parseLockfile, parserFor, supportedFilenames } from './registry.js';
import { splitNameAndVersion, splitYarnDescriptor } from './spec.js';

const encoder = new TextEncoder();

describe('parserFor', () => {
  it('selects by filename, ignoring the directory and the case', () => {
    expect(parserFor('/repo/package-lock.json')?.format).toBe('package-lock.json');
    expect(parserFor('C:\\repo\\PNPM-LOCK.YAML')?.format).toBe('pnpm-lock.yaml');
    expect(parserFor('Pipfile.lock')?.format).toBe('Pipfile.lock');
  });

  it('claims npm-shrinkwrap.json as well as package-lock.json', () => {
    expect(parserFor('npm-shrinkwrap.json')?.format).toBe('package-lock.json');
  });

  it('returns undefined for a filename dumpscan does not read', () => {
    expect(parserFor('package.json')).toBeUndefined();
    expect(parserFor('Gemfile.lock')).toBeUndefined();
  });
});

describe('supportedFilenames', () => {
  it('lists every filename a parser claims, sorted', () => {
    const names = supportedFilenames();
    expect(names).toStrictEqual([...names].sort());
    expect(names).toContain('uv.lock');
    expect(names).toContain('requirements.txt');
  });
});

describe('parseLockfile', () => {
  it('names the formats it does read when it does not recognize one', () => {
    expect(() => parseLockfile('Gemfile.lock', encoder.encode('{}'))).toThrow(
      /no parser reads "Gemfile.lock"; dumpscan reads .*uv\.lock/,
    );
  });

  it('raises UnpinnedLockfileError rather than a parse failure for a loose requirements file', () => {
    expect(() => parseLockfile('requirements.txt', encoder.encode('flask>=2\n'))).toThrow(
      UnpinnedLockfileError,
    );
  });
});

describe('parseInput', () => {
  it('hashes the raw bytes and decodes them as UTF-8', () => {
    const input = parseInput('/repo/uv.lock', encoder.encode('version = 1\n'));
    expect(input.filename).toBe('uv.lock');
    expect(input.text).toBe('version = 1\n');
    expect(input.lockfileDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('strips a byte order mark so it does not become part of the first key', () => {
    const input = parseInput('uv.lock', encoder.encode('\ufeffversion = 1\n'));
    expect(input.text.startsWith('version')).toBe(true);
  });
});

describe('basename', () => {
  it('handles both separators and a bare name', () => {
    expect(basename('a/b/c.json')).toBe('c.json');
    expect(basename('a\\b\\c.json')).toBe('c.json');
    expect(basename('c.json')).toBe('c.json');
  });
});

describe('splitNameAndVersion', () => {
  it('splits on the last at sign so a scope survives', () => {
    expect(splitNameAndVersion('lodash@4.17.21')).toStrictEqual({
      name: 'lodash',
      version: '4.17.21',
    });
    expect(splitNameAndVersion('@scope/pkg@1.0.0')).toStrictEqual({
      name: '@scope/pkg',
      version: '1.0.0',
    });
  });

  it('returns null when there is nothing to split', () => {
    expect(splitNameAndVersion('lodash')).toBeNull();
    expect(splitNameAndVersion('@scope/pkg')).toBeNull();
    expect(splitNameAndVersion('lodash@')).toBeNull();
    expect(splitNameAndVersion('@1.0.0')).toBeNull();
  });
});

describe('splitYarnDescriptor', () => {
  it('separates the protocol from the range', () => {
    expect(splitYarnDescriptor('lodash@npm:^4.17.20')).toStrictEqual({
      name: 'lodash',
      protocol: 'npm',
      range: '^4.17.20',
    });
  });

  it('reports no protocol for a classic descriptor', () => {
    expect(splitYarnDescriptor('lodash@^4.17.20')).toStrictEqual({
      name: 'lodash',
      protocol: null,
      range: '^4.17.20',
    });
  });

  it('strips surrounding quotes and whitespace', () => {
    expect(splitYarnDescriptor('  "@scope/pkg@workspace:packages/pkg"  ')?.protocol).toBe(
      'workspace',
    );
  });

  it('returns null for a descriptor with no version part', () => {
    expect(splitYarnDescriptor('lodash')).toBeNull();
  });
});

describe('closureFrom', () => {
  const nodes = new Map<string, DependencyNode>([
    ['a', { key: 'a', name: 'a', version: '1', dependencies: ['b', 'missing'] }],
    ['b', { key: 'b', name: 'b', version: '1', dependencies: ['c'] }],
    ['c', { key: 'c', name: 'c', version: '1', dependencies: ['a'] }],
    ['orphan', { key: 'orphan', name: 'orphan', version: '1', dependencies: [] }],
  ]);

  it('reaches everything transitively without following a cycle forever', () => {
    expect(closureFrom(nodes, ['a']).map((node) => node.key)).toStrictEqual(['a', 'b', 'c']);
  });

  it('ignores keys with no node', () => {
    expect(closureFrom(nodes, ['missing'])).toStrictEqual([]);
  });

  it('does not depend on the order the roots were listed', () => {
    expect(closureFrom(nodes, ['a', 'orphan']).map((n) => n.key)).toStrictEqual(
      closureFrom(nodes, ['orphan', 'a']).map((n) => n.key),
    );
  });

  it('returns nothing for no roots', () => {
    expect(closureFrom(nodes, [])).toStrictEqual([]);
  });
});
