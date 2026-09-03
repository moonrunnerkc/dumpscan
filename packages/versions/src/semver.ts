import { compareCodeUnits } from '@dumpscan/canon';

import { compareDigitStrings } from './order.js';

/**
 * node-semver refuses a numeric component above this, so dumpscan does too. The
 * npm registry is the reference implementation for the npm ecosystem, and a
 * comparator that accepts versions npm itself rejects would report findings for
 * packages that cannot exist.
 */
const MAX_SAFE_COMPONENT = Number.MAX_SAFE_INTEGER;

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const NUMERIC = /^\d+$/;

export interface SemverVersion {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}

/**
 * Parses a strict SemVer 2.0.0 version.
 *
 * No coercion: `1.0`, `v1.0.0`, and a leading zero component are all rejected,
 * matching node-semver rather than guessing what the author meant.
 *
 * @param value - The version string.
 * @returns The parsed version, or null when the string is not valid SemVer.
 */
export function parseSemver(value: string): SemverVersion | null {
  const match = SEMVER.exec(value);
  if (match === null) return null;

  // The three numeric groups are not optional in the pattern, so a match
  // guarantees them. The optional groups default to the empty string, which is
  // also what an empty capture would give.
  const [, major = '', minor = '', patch = '', prerelease = '', build = ''] = match;
  for (const component of [major, minor, patch]) {
    if (Number(component) > MAX_SAFE_COMPONENT) return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease: prerelease === '' ? [] : prerelease.split('.'),
    build: build === '' ? [] : build.split('.'),
  };
}

/**
 * Compares two SemVer versions by precedence.
 *
 * Build metadata is ignored, as SemVer 2.0.0 section 10 requires. A version with
 * a prerelease has lower precedence than the same version without one.
 *
 * @param a - Left version.
 * @param b - Right version.
 * @returns Negative when a is lower, positive when b is, zero for equal precedence.
 * @throws Error when either string is not valid SemVer.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  if (left === null) {
    throw new Error(
      `compareSemver: ${JSON.stringify(a)} is not a SemVer 2.0.0 version; npm versions are major.minor.patch with no leading zeros, so fix the lockfile or record the comparison as unevaluated`,
    );
  }
  const right = parseSemver(b);
  if (right === null) {
    throw new Error(
      `compareSemver: ${JSON.stringify(b)} is not a SemVer 2.0.0 version; npm versions are major.minor.patch with no leading zeros, so fix the lockfile or record the comparison as unevaluated`,
    );
  }
  return compareParsedSemver(left, right);
}

/**
 * Compares two already parsed SemVer versions.
 *
 * @param a - Left version.
 * @param b - Right version.
 * @returns Negative when a is lower, positive when b is, zero for equal precedence.
 */
export function compareParsedSemver(a: SemverVersion, b: SemverVersion): number {
  for (const [left, right] of [
    [a.major, b.major],
    [a.minor, b.minor],
    [a.patch, b.patch],
  ] as const) {
    const result = compareDigitStrings(left, right);
    if (result !== 0) return result;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
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
