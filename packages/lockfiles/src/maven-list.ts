import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputPackage } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';

/** `groupId:artifactId:type[:classifier]:version:scope`, optionally behind Maven log noise. */
const COORDINATE = /^(?:\[[A-Z]+\]\s*)?([\w.\-]+(?::[\w.\-]+){3,5})(?:\s+--\s+.*)?$/;

const SKIPPED = /^(?:\[[A-Z]+\]\s*)?(?:none|The following files have been resolved:|-+.*)?$/;

/**
 * Parses the output of `mvn dependency:list`.
 *
 * Maven has no lockfile. `dependency:list` is the closest thing: it prints the
 * coordinates Maven actually resolved, which is exactly the resolved package set
 * dumpscan needs. Both the console form with `[INFO]` prefixes and the plain
 * form written by `-DoutputFile` are read.
 *
 * A coordinate is `groupId:artifactId:type:version:scope`, with an optional
 * classifier between the type and the version, so the version is always the
 * second to last field.
 */
export const mavenListParser: LockfileParser = {
  format: 'dependency-list.txt',
  filenames: ['dependency-list.txt', 'maven-dependency-list.txt'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  const packages: InputPackage[] = [];

  for (const raw of input.text.split('\n')) {
    const line = raw.replace(/\r$/, '').trimEnd();
    const trimmed = line.trim();
    if (trimmed === '' || SKIPPED.test(trimmed)) continue;

    const match = COORDINATE.exec(trimmed);
    if (match === null) continue;

    const fields = (match[1] as string).split(':');
    const group = fields[0] as string;
    const artifact = fields[1] as string;
    const version = fields[fields.length - 2] as string;
    if (group === '' || artifact === '' || version === '') continue;
    packages.push(inputPackage('Maven', `${group}:${artifact}`, version));
  }

  if (packages.length === 0) {
    throw new Error(
      `dependency-list.txt: ${input.filename} has no Maven coordinates; run mvn dependency:list and pass its output, which lists groupId:artifactId:type:version:scope one per line`,
    );
  }

  const format = 'mvn dependency:list';
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
