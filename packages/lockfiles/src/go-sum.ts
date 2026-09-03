import { compareCodeUnits } from '@dumpscan/canon';

import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputPackage } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';

/** `module version hash` or `module version/go.mod hash`. */
const GO_SUM_LINE = /^(\S+)\s+(\S+?)(\/go\.mod)?\s+(\S+)$/;

/** The escaped form the module proxy uses: an uppercase letter becomes !letter. */
const ESCAPE = /!([a-z])/g;

/**
 * Parses `go.sum`, optionally alongside the `go.mod` beside it.
 *
 * `go.sum` is a record of every module version the build has ever verified, not
 * of the modules the build actually links. It over-approximates, so the manifest
 * carries `overApproximated: true` and the findings that come out of it are an
 * upper bound. That flag is part of the hashed manifest, so a reader of the
 * predicate knows it without being told.
 *
 * When a `go.mod` is available its `module` line names the main module, which is
 * excluded from the package set: it is the thing being scanned, not a dependency.
 */
export const goSumParser: LockfileParser = {
  format: 'go.sum',
  filenames: ['go.sum'],
  parse,
};

/**
 * Reads the `module` path from a `go.mod`.
 *
 * @param text - The go.mod contents.
 * @returns The module path, or null when the file declares none.
 */
export function mainModulePath(text: string): string | null {
  const match = /^\s*module\s+(\S+)/m.exec(text);
  return match?.[1] ?? null;
}

/**
 * Unescapes a module proxy path, turning `!f!o!o` back into `FOO`.
 *
 * @param path - A possibly escaped module path.
 * @returns The unescaped path.
 */
export function unescapeModulePath(path: string): string {
  return path.replace(ESCAPE, (_match, letter: string) => letter.toUpperCase());
}

function parse(input: ParseInput): ParsedLockfile {
  const packages: InputPackage[] = [];
  const unresolved: string[] = [];
  const mainModule = input.sidecars?.['go.mod'];
  const excluded = mainModule === undefined ? null : mainModulePath(mainModule);

  for (const raw of input.text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('//')) continue;

    const match = GO_SUM_LINE.exec(line);
    if (match === null) {
      throw new Error(
        `go.sum: ${input.filename} has a line dumpscan cannot read: ${JSON.stringify(line)}; every line is a module path, a version, and a hash`,
      );
    }

    const modulePath = unescapeModulePath(match[1] as string);
    const version = match[2] as string;
    if (excluded !== null && modulePath === excluded) continue;

    if (version.startsWith('v') && version.length > 1) {
      packages.push(inputPackage('Go', modulePath, version));
    } else {
      unresolved.push(modulePath);
    }
  }

  const format = excluded === null ? 'go.sum' : 'go.sum with go.mod';
  return {
    format,
    manifests: [
      buildManifest({
        format,
        lockfileDigest: input.lockfileDigest,
        workspaceRoot: ROOT_WORKSPACE,
        overApproximated: true,
        packages,
        unresolved: [...new Set(unresolved)].sort(compareCodeUnits),
      }),
    ],
  };
}
