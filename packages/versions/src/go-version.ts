import { compareCodeUnits } from '@dumpscan/canon';

import { compareDigitStrings } from './order.js';

/**
 * Go module versions, as `golang.org/x/mod/semver` defines them: SemVer with the
 * minor and patch components optional.
 *
 * The leading `v` is optional here even though the module proxy always writes
 * one, because OSV strips it from its Go advisories while `go.sum` keeps it.
 * They are the same version, and a comparator that read only one spelling would
 * report every Go package as unevaluated.
 *
 * A pseudo-version such as `v0.0.0-20191109021931-daa7c04131f5` needs no special
 * case: it is an ordinary prerelease, and its timestamp prefix makes prereleases
 * of the same base version sort by when they were cut.
 */
const GO_VERSION =
  /^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const NUMERIC = /^\d+$/;

export interface GoVersion {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[];
  /** Build metadata, which includes the `+incompatible` marker. Never compared. */
  readonly build: readonly string[];
}

/**
 * Strips the `v` a Go module version carries and OSV does not.
 *
 * @param value - A Go module version in either spelling.
 * @returns The version with no leading `v`.
 */
export function stripGoPrefix(value: string): string {
  return value.startsWith('v') ? value.slice(1) : value;
}

/**
 * Parses a Go module version.
 *
 * @param value - The version string, including its `v` prefix.
 * @returns The parsed version, or null when it is not a Go module version.
 */
export function parseGoVersion(value: string): GoVersion | null {
  const match = GO_VERSION.exec(value);
  if (match === null) return null;
  const [, major = '', minor = '0', patch = '0', prerelease = '', build = ''] = match;
  return {
    major,
    minor,
    patch,
    prerelease: prerelease === '' ? [] : prerelease.split('.'),
    build: build === '' ? [] : build.split('.'),
  };
}

/**
 * Compares two Go module versions.
 *
 * Build metadata is ignored, which is what makes `v2.0.0+incompatible` and
 * `v2.0.0` the same version to the module proxy.
 *
 * @param a - Left version.
 * @param b - Right version.
 * @returns Negative when a is lower, positive when b is, zero for equal ordering.
 * @throws Error when either string is not a Go module version.
 */
export function compareGoVersion(a: string, b: string): number {
  const left = parseGoVersion(a);
  if (left === null) {
    throw new Error(
      `compareGoVersion: ${JSON.stringify(a)} is not a Go module version; Go versions are major.minor.patch with no leading zeros and an optional v, so fix the go.sum or record the comparison as unevaluated`,
    );
  }
  const right = parseGoVersion(b);
  if (right === null) {
    throw new Error(
      `compareGoVersion: ${JSON.stringify(b)} is not a Go module version; Go versions are major.minor.patch with no leading zeros and an optional v, so fix the go.sum or record the comparison as unevaluated`,
    );
  }

  for (const [x, y] of [
    [left.major, right.major],
    [left.minor, right.minor],
    [left.patch, right.patch],
  ] as const) {
    const result = compareDigitStrings(x, y);
    if (result !== 0) return result;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const result = compareIdentifier(a[i] as string, b[i] as string);
    if (result !== 0) return result;
  }
  return a.length - b.length;
}

function compareIdentifier(a: string, b: string): number {
  const numericA = NUMERIC.test(a);
  const numericB = NUMERIC.test(b);
  if (numericA && numericB) return compareDigitStrings(a, b);
  if (numericA) return -1;
  if (numericB) return 1;
  return compareCodeUnits(a, b);
}
