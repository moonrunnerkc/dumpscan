import { compareCodeUnits } from '@dumpscan/canon';

import { packageLockParser } from './npm-package-lock.js';
import { pnpmLockParser } from './npm-pnpm-lock.js';
import { yarnLockParser } from './npm-yarn-lock.js';
import { basename, parseInput } from './parser.js';
import type { LockfileParser, ParsedLockfile } from './parser.js';
import { pipfileLockParser } from './pypi-pipfile-lock.js';
import { poetryLockParser } from './pypi-poetry-lock.js';
import { requirementsParser } from './pypi-requirements.js';
import { uvLockParser } from './pypi-uv-lock.js';

/** Every parser dumpscan ships, in the order they are offered a filename. */
export const PARSERS: readonly LockfileParser[] = [
  packageLockParser,
  pnpmLockParser,
  yarnLockParser,
  uvLockParser,
  poetryLockParser,
  pipfileLockParser,
  requirementsParser,
];

const BY_FILENAME = new Map<string, LockfileParser>(
  PARSERS.flatMap((parser) => parser.filenames.map((name) => [name, parser] as const)),
);

/**
 * Finds the parser for a lockfile path.
 *
 * Selection is by filename only. Sniffing contents would mean two files with
 * the same name parsing differently depending on what is inside them, and the
 * detected format is recorded in the manifest and therefore in the digest.
 *
 * @param path - Path or basename of the lockfile.
 * @returns The parser, or undefined when the filename is not one dumpscan reads.
 */
export function parserFor(path: string): LockfileParser | undefined {
  return BY_FILENAME.get(basename(path).toLowerCase());
}

/**
 * Parses a lockfile into one or more input manifests.
 *
 * @param path - Path of the lockfile, used to select the parser and in messages.
 * @param bytes - The file contents.
 * @returns The detected format and its manifests.
 * @throws Error when no parser claims the filename, or when the parser refuses
 * the contents.
 */
export function parseLockfile(path: string, bytes: Uint8Array): ParsedLockfile {
  const parser = parserFor(path);
  if (parser === undefined) {
    const known = [...BY_FILENAME.keys()].sort(compareCodeUnits).join(', ');
    throw new Error(
      `parseLockfile: no parser reads ${JSON.stringify(basename(path))}; dumpscan reads ${known}`,
    );
  }
  return parser.parse(parseInput(path, bytes));
}

/**
 * Lists the filenames dumpscan can parse.
 *
 * @returns The recognized filenames, sorted.
 */
export function supportedFilenames(): string[] {
  return [...BY_FILENAME.keys()].sort(compareCodeUnits);
}
