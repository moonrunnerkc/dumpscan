import { parse as parseToml } from 'smol-toml';

import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputPackage } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';

type Record_ = Record<string, unknown>;

/**
 * Parses `Cargo.lock` v3 and v4.
 *
 * Both versions carry the same `[[package]]` array; v4 moved the checksum from a
 * `[metadata]` table onto the package entry and changed how dependencies are
 * spelled, neither of which affects the resolved name and version. A package
 * with a `source` that is not a registry, a git dependency or a vendored path,
 * has a version taken from its own Cargo.toml rather than one crates.io
 * published, so it is recorded as unresolved. A package with no `source` at all
 * is a workspace member.
 */
export const cargoLockParser: LockfileParser = {
  format: 'Cargo.lock',
  filenames: ['cargo.lock'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  const document = parseToml(input.text) as Record_;
  const declared = document['version'];
  const version = typeof declared === 'number' ? declared : 3;
  if (version !== 3 && version !== 4) {
    throw new Error(
      `Cargo.lock: ${input.filename} is version ${version}, and dumpscan reads 3 and 4; run cargo update with a toolchain that writes one of those`,
    );
  }

  const entries = Array.isArray(document['package']) ? (document['package'] as Record_[]) : [];
  const packages: InputPackage[] = [];
  const unresolved: string[] = [];

  for (const entry of entries) {
    const name = entry['name'];
    const packageVersion = entry['version'];
    if (typeof name !== 'string' || name === '' || typeof packageVersion !== 'string') continue;

    const source = entry['source'];
    if (source === undefined) continue;
    if (typeof source !== 'string' || !source.startsWith('registry+')) {
      unresolved.push(name);
      continue;
    }
    packages.push(inputPackage('crates.io', name, packageVersion));
  }

  const format = `Cargo.lock v${version}`;
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
