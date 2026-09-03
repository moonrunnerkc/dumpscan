import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputPackage } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';

/** `group:artifact:version=configuration,configuration`. */
const ENTRY = /^([\w.\-]+):([\w.\-]+):([^=\s]+)=(.*)$/;

/**
 * Parses a Gradle dependency lockfile.
 *
 * Gradle writes one `group:artifact:version=configurations` line per resolved
 * dependency, plus an `empty=` line naming the configurations that resolved to
 * nothing. The configurations are which classpaths pulled the dependency in, so
 * they do not change the resolved package set and are not recorded.
 */
export const gradleLockfileParser: LockfileParser = {
  format: 'gradle.lockfile',
  filenames: ['gradle.lockfile'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  const packages: InputPackage[] = [];

  for (const raw of input.text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith('empty=')) continue;

    const match = ENTRY.exec(line);
    if (match === null) {
      throw new Error(
        `gradle.lockfile: ${input.filename} has a line dumpscan cannot read: ${JSON.stringify(line)}; every entry is group:artifact:version=configurations`,
      );
    }
    packages.push(
      inputPackage('Maven', `${match[1] as string}:${match[2] as string}`, match[3] as string),
    );
  }

  const format = 'gradle.lockfile';
  return {
    format,
    manifests: [
      buildManifest({
        format,
        lockfileDigest: input.lockfileDigest,
        workspaceRoot: ROOT_WORKSPACE,
        overApproximated: false,
        packages,
        unresolved: [],
      }),
    ],
  };
}
