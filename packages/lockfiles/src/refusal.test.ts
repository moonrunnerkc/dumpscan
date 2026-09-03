import { describe, expect, it } from 'vitest';

import { parseInput } from './parser.js';
import { packageLockParser } from './npm-package-lock.js';
import { pnpmLockParser } from './npm-pnpm-lock.js';
import { yarnLockParser } from './npm-yarn-lock.js';
import { pipfileLockParser } from './pypi-pipfile-lock.js';
import { poetryLockParser } from './pypi-poetry-lock.js';
import { requirementsParser } from './pypi-requirements.js';
import { uvLockParser } from './pypi-uv-lock.js';

const encoder = new TextEncoder();

function run(parser: { parse: typeof packageLockParser.parse }, filename: string, text: string) {
  return parser.parse(parseInput(filename, encoder.encode(text)));
}

describe('package-lock.json refusals', () => {
  it('refuses a v1 lockfile and says how to upgrade it', () => {
    expect(() => run(packageLockParser, 'package-lock.json', '{"lockfileVersion":1}')).toThrow(
      /is lockfileVersion 1, and dumpscan reads 2 and 3/,
    );
  });

  it('refuses a document that is not an object', () => {
    expect(() => run(packageLockParser, 'package-lock.json', '[]')).toThrow(/is not a JSON object/);
  });

  it('refuses a lockfile with no version and one with no packages map', () => {
    expect(() => run(packageLockParser, 'package-lock.json', '{}')).toThrow(
      /has no numeric lockfileVersion/,
    );
    expect(() => run(packageLockParser, 'package-lock.json', '{"lockfileVersion":3}')).toThrow(
      /has no packages map/,
    );
  });

  it('takes the name from the entry when the path is nested', () => {
    const parsed = run(
      packageLockParser,
      'package-lock.json',
      '{"lockfileVersion":3,"packages":{"node_modules/a/node_modules/b":{"version":"1.0.0"}}}',
    );
    expect(parsed.manifests[0]?.packages[0]?.name).toBe('b');
  });
});

describe('pnpm-lock.yaml refusals', () => {
  it('refuses a lockfile version it does not read', () => {
    expect(() => run(pnpmLockParser, 'pnpm-lock.yaml', "lockfileVersion: '5.4'\n")).toThrow(
      /is lockfileVersion 5.4, and dumpscan reads 6 and 9/,
    );
  });

  it('refuses a lockfile with no version', () => {
    expect(() => run(pnpmLockParser, 'pnpm-lock.yaml', 'importers: {}\n')).toThrow(
      /has no lockfileVersion/,
    );
  });

  it('refuses a non mapping document', () => {
    expect(() => run(pnpmLockParser, 'pnpm-lock.yaml', '- a\n- b\n')).toThrow(
      /did not parse as a YAML mapping/,
    );
  });

  it('refuses a package key with no name and version', () => {
    expect(() =>
      run(pnpmLockParser, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages:\n  broken: {}\n"),
    ).toThrow(/has a package key "broken" with no name@version/);
  });

  it('strips a peer suffix from the key when reading the version', () => {
    const parsed = run(
      pnpmLockParser,
      'pnpm-lock.yaml',
      "lockfileVersion: '9.0'\npackages:\n  'a@1.0.0(react@18.2.0)': {}\n",
    );
    expect(parsed.manifests[0]?.packages[0]).toMatchObject({ name: 'a', version: '1.0.0' });
  });
});

describe('yarn.lock handling', () => {
  it('reads a classic lockfile with no version header as v1', () => {
    const parsed = run(yarnLockParser, 'yarn.lock', 'a@^1.0.0:\n  version "1.0.0"\n');
    expect(parsed.format).toBe('yarn.lock classic v1');
  });

  it('records a classic entry with no version as unresolved', () => {
    const parsed = run(yarnLockParser, 'yarn.lock', 'a@^1.0.0:\n  resolved "https://x/a.tgz"\n');
    expect(parsed.manifests[0]?.unresolved).toStrictEqual(['a']);
  });

  it('falls back to the classic reader when the file is not YAML at all', () => {
    const parsed = run(yarnLockParser, 'yarn.lock', 'a@^1.0.0:\n  version "1.0.0"\n  [\n');
    expect(parsed.format).toBe('yarn.lock classic v1');
    expect(parsed.manifests[0]?.packages[0]?.version).toBe('1.0.0');
  });

  it('skips workspace and file protocol entries in Berry', () => {
    const parsed = run(
      yarnLockParser,
      'yarn.lock',
      '__metadata:\n  version: 8\n\n"a@workspace:packages/a":\n  version: 0.0.0-use.local\n  resolution: "a@workspace:packages/a"\n',
    );
    expect(parsed.manifests[0]?.packages).toStrictEqual([]);
  });

  it('records a Berry entry with no version as unresolved', () => {
    const parsed = run(
      yarnLockParser,
      'yarn.lock',
      '__metadata:\n  version: 8\n\n"a@npm:^1.0.0":\n  resolution: "a@npm:1.0.0"\n',
    );
    expect(parsed.manifests[0]?.unresolved).toStrictEqual(['a']);
  });
});

describe('PyPI lockfile refusals', () => {
  it('refuses a uv.lock with no version field', () => {
    expect(() => run(uvLockParser, 'uv.lock', 'requires-python = ">=3.11"\n')).toThrow(
      /has no numeric version field/,
    );
  });

  it('refuses a poetry.lock with no metadata.lock-version', () => {
    expect(() => run(poetryLockParser, 'poetry.lock', '[[package]]\nname = "a"\n')).toThrow(
      /has no metadata.lock-version/,
    );
  });

  it('refuses a Pipfile.lock that is not an object or has no _meta', () => {
    expect(() => run(pipfileLockParser, 'Pipfile.lock', '[]')).toThrow(/is not a JSON object/);
    expect(() => run(pipfileLockParser, 'Pipfile.lock', '{}')).toThrow(/has no _meta section/);
  });

  it('reports an unversioned Pipfile.lock spec rather than guessing', () => {
    const parsed = run(pipfileLockParser, 'Pipfile.lock', '{"_meta":{}}');
    expect(parsed.format).toBe('Pipfile.lock spec unversioned');
  });
});

describe('requirements.txt refusals', () => {
  it('accepts arbitrary equality as well as ordinary equality', () => {
    const parsed = run(requirementsParser, 'requirements.txt', 'a===1.0.0\n');
    expect(parsed.manifests[0]?.packages[0]?.version).toBe('1.0.0');
  });

  it('names the line number of the first requirement that is not pinned', () => {
    expect(() => run(requirementsParser, 'requirements.txt', '# c\na==1.0.0\nb~=2.0\n')).toThrow(
      /line 3 is "b~=2.0"/,
    );
  });

  it('refuses an editable install and an included file', () => {
    expect(() => run(requirementsParser, 'requirements.txt', '-e .\n')).toThrow(/line 1 is "-e \./);
    expect(() => run(requirementsParser, 'requirements.txt', '--index-url https://x\n')).toThrow(
      /does not follow options or included files/,
    );
  });

  it('joins a continuation line before judging it', () => {
    const parsed = run(
      requirementsParser,
      'requirements.txt',
      'a==1.0.0 \\\n    --hash=sha256:aa\n',
    );
    expect(parsed.manifests[0]?.packages).toHaveLength(1);
  });

  it('reports the starting line of a continued requirement', () => {
    expect(() =>
      run(
        requirementsParser,
        'requirements.txt',
        'a==1.0.0\nb>=2 \\\n    ; python_version > "3"\n',
      ),
    ).toThrow(/line 2 is "b>=2 ; python_version > \\"3\\""/);
  });

  it('ignores comments, blank lines, and trailing comments', () => {
    const parsed = run(
      requirementsParser,
      'requirements.txt',
      '\n# leading\na==1.0.0  # trailing\n\n',
    );
    expect(parsed.manifests[0]?.packages).toHaveLength(1);
  });

  it('keeps an environment marker out of the version', () => {
    const parsed = run(
      requirementsParser,
      'requirements.txt',
      'a==1.0.0 ; python_version >= "3.11"\n',
    );
    expect(parsed.manifests[0]?.packages[0]?.version).toBe('1.0.0');
  });
});
