import { isJsonObject, parseJson } from '@dumpscan/canon';
import type { JsonObject } from '@dumpscan/canon';

import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputPackage } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';

const SECTIONS = ['default', 'develop'] as const;

/**
 * Parses `Pipfile.lock`.
 *
 * Every entry in `default` and `develop` carries a `version` of the form
 * `==2.31.0`. Entries that name a git ref, a file, or an editable path instead
 * have no such version, and there is nothing to compare a PyPI advisory range
 * against, so they are recorded as unresolved rather than dropped.
 */
export const pipfileLockParser: LockfileParser = {
  format: 'Pipfile.lock',
  filenames: ['pipfile.lock'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  const document = parseJson(input.text);
  if (!isJsonObject(document)) {
    throw new Error(
      `Pipfile.lock: ${input.filename} is not a JSON object; pipenv writes a single object with _meta, default, and develop sections`,
    );
  }

  const meta = document['_meta'];
  if (!isJsonObject(meta)) {
    throw new Error(
      `Pipfile.lock: ${input.filename} has no _meta section; the file is truncated or is not a Pipfile.lock`,
    );
  }

  const packages: InputPackage[] = [];
  const unresolved: string[] = [];

  for (const section of SECTIONS) {
    const entries = document[section];
    if (!isJsonObject(entries)) continue;
    for (const [name, value] of Object.entries(entries)) {
      if (!isJsonObject(value)) continue;
      const version = exactVersion(value);
      if (version === null) unresolved.push(name);
      else packages.push(inputPackage('PyPI', name, version));
    }
  }

  const format = `Pipfile.lock spec ${pipfileSpec(meta)}`;
  return {
    format,
    manifests: [
      buildManifest({
        format,
        lockfileDigest: input.lockfileDigest,
        workspaceRoot: ROOT_WORKSPACE,
        overApproximated: false,
        packages,
        unresolved,
      }),
    ],
  };
}

function exactVersion(entry: JsonObject): string | null {
  const version = entry['version'];
  if (typeof version !== 'string') return null;
  if (!version.startsWith('==')) return null;
  const exact = version.slice(2).trim();
  return exact === '' || exact.includes('*') ? null : exact;
}

function pipfileSpec(meta: JsonObject): string {
  const spec = meta['pipfile-spec'];
  return typeof spec === 'number' ? String(spec) : 'unversioned';
}
