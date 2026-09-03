import { isJsonObject, parseJson } from '@dumpscan/canon';
import type { JsonObject } from '@dumpscan/canon';

import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputPackage } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';

const NODE_MODULES = 'node_modules/';

/**
 * Parses `package-lock.json` v2 and v3.
 *
 * The `packages` map is the resolved tree: every key under a `node_modules/`
 * path is something npm installs. Entries marked `link` point at a workspace
 * member rather than a registry tarball, and the member's own entry is the one
 * that carries a version, so links are skipped rather than counted twice.
 *
 * v1 lockfiles have no `packages` map and are refused. Their `dependencies`
 * tree records versions but not the installed layout, and reconstructing one
 * would mean guessing at hoisting.
 *
 * npm resolves the whole workspace into one tree and does not record which
 * member pulled in what, so this parser produces the single manifest for
 * workspace root `.`.
 */
export const packageLockParser: LockfileParser = {
  format: 'package-lock.json',
  filenames: ['package-lock.json', 'npm-shrinkwrap.json'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  const document = parseJson(input.text);
  if (!isJsonObject(document)) {
    throw new Error(
      `package-lock.json: ${input.filename} is not a JSON object; an npm lockfile is a single object with a packages map`,
    );
  }

  const lockfileVersion = document['lockfileVersion'];
  if (typeof lockfileVersion !== 'number') {
    throw new Error(
      `package-lock.json: ${input.filename} has no numeric lockfileVersion; npm writes one on every lockfile it produces`,
    );
  }
  if (lockfileVersion < 2) {
    throw new Error(
      `package-lock.json: ${input.filename} is lockfileVersion ${lockfileVersion}, and dumpscan reads 2 and 3; run npm install with npm 7 or later to upgrade it, because a v1 lockfile does not record the installed tree`,
    );
  }

  const packages = document['packages'];
  if (!isJsonObject(packages)) {
    throw new Error(
      `package-lock.json: ${input.filename} declares lockfileVersion ${lockfileVersion} but has no packages map; the file is truncated or was edited by hand`,
    );
  }

  const resolved: InputPackage[] = [];
  const unresolved: string[] = [];

  for (const [path, entry] of Object.entries(packages)) {
    if (path === '' || !isJsonObject(entry)) continue;
    const marker = path.lastIndexOf(NODE_MODULES);
    if (marker === -1) continue;
    if (entry['link'] === true) continue;

    const name = nameOf(entry, path.slice(marker + NODE_MODULES.length));
    const version = entry['version'];
    if (typeof version !== 'string' || version === '' || !fromRegistry(entry)) {
      unresolved.push(name);
      continue;
    }
    resolved.push(inputPackage('npm', name, version));
  }

  return {
    format: `package-lock.json v${lockfileVersion}`,
    manifests: [
      buildManifest({
        format: `package-lock.json v${lockfileVersion}`,
        lockfileDigest: input.lockfileDigest,
        workspaceRoot: ROOT_WORKSPACE,
        overApproximated: false,
        packages: resolved,
        unresolved,
      }),
    ],
  };
}

// A git, file, or tarball dependency carries the version from its package.json,
// which is not a version any registry published and not one an advisory range
// can be evaluated against.
function fromRegistry(entry: JsonObject): boolean {
  const resolved = entry['resolved'];
  if (typeof resolved !== 'string') return true;
  return resolved.startsWith('https://') || resolved.startsWith('http://');
}

function nameOf(entry: JsonObject, fromPath: string): string {
  const declared = entry['name'];
  return typeof declared === 'string' && declared !== '' ? declared : fromPath;
}
