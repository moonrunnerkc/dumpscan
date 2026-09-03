import { parse as parseToml } from 'smol-toml';

import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputPackage } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';

type Record_ = Record<string, unknown>;

/**
 * Parses `poetry.lock`.
 *
 * poetry writes one flat `[[package]]` array with a resolved version on every
 * entry and no per-project grouping, so it yields a single manifest. Packages
 * whose source is a git or directory reference have a version poetry made up
 * from the project metadata rather than one PyPI would recognize, so they are
 * recorded as unresolved instead of matched against PyPI advisories.
 */
export const poetryLockParser: LockfileParser = {
  format: 'poetry.lock',
  filenames: ['poetry.lock'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  const document = parseToml(input.text) as Record_;
  const metadata = asRecord(document['metadata']);
  const lockVersion = metadata['lock-version'];
  if (typeof lockVersion !== 'string') {
    throw new Error(
      `poetry.lock: ${input.filename} has no metadata.lock-version; poetry writes one on every lockfile it produces`,
    );
  }
  const format = `poetry.lock v${lockVersion}`;

  const entries = Array.isArray(document['package']) ? (document['package'] as Record_[]) : [];
  const packages: InputPackage[] = [];
  const unresolved: string[] = [];

  for (const entry of entries) {
    const name = entry['name'];
    const version = entry['version'];
    if (typeof name !== 'string' || name === '') continue;
    const source = asRecord(entry['source'])['type'];
    if (
      typeof version !== 'string' ||
      version === '' ||
      (typeof source === 'string' && source !== 'legacy')
    ) {
      unresolved.push(name);
      continue;
    }
    packages.push(inputPackage('PyPI', name, version));
  }

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

function asRecord(value: unknown): Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record_)
    : {};
}
