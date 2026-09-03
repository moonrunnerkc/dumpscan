import { digest } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';

import type { InputManifest } from './manifest.js';

export interface ParseInput {
  /** Basename of the lockfile, used to pick a parser and in error messages. */
  readonly filename: string;
  /** Raw bytes exactly as read, hashed for traceability. */
  readonly bytes: Uint8Array;
  /** The bytes decoded as UTF-8. */
  readonly text: string;
  /** SHA-256 of the raw bytes. */
  readonly lockfileDigest: Digest;
  /**
   * Adjacent files a parser may consult, keyed by basename. `go.sum` reads the
   * `go.mod` beside it to learn the main module path. Sidecars are never hashed
   * into the lockfile digest: only the file being parsed is.
   */
  readonly sidecars?: Readonly<Record<string, string>>;
}

export interface ParsedLockfile {
  /** Detected format including its declared version. */
  readonly format: string;
  /**
   * One manifest per resolved package set. Always includes the manifest for
   * workspace root `.`; formats that record per-member dependency edges add one
   * manifest per member.
   */
  readonly manifests: readonly InputManifest[];
}

export interface LockfileParser {
  /** Stable identifier for the format family, without a version. */
  readonly format: string;
  /** Filenames this parser claims, lowercased. */
  readonly filenames: readonly string[];
  parse(input: ParseInput): ParsedLockfile;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Builds the input a parser reads from raw bytes.
 *
 * @param filename - Path or basename of the lockfile.
 * @param bytes - The file contents.
 * @param sidecars - Adjacent files, keyed by basename, that the parser may read.
 * @returns The parse input, with the raw digest already computed.
 */
export function parseInput(
  filename: string,
  bytes: Uint8Array,
  sidecars?: Readonly<Record<string, string>>,
): ParseInput {
  return {
    filename: basename(filename),
    bytes,
    text: stripBom(decoder.decode(bytes)),
    lockfileDigest: digest(bytes),
    ...(sidecars === undefined ? {} : { sidecars }),
  };
}

/**
 * Returns the last path segment of a path written with either separator.
 *
 * @param path - A file path.
 * @returns The basename.
 */
export function basename(path: string): string {
  const normalized = path.split('\\').join('/');
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Raised when a lockfile is recognized but cannot be reduced to exact versions.
 * Distinct from a parse failure so the CLI can tell the user what to change
 * rather than reporting a corrupt file.
 */
export class UnpinnedLockfileError extends Error {
  override readonly name = 'UnpinnedLockfileError';
}
