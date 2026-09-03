import { ABOVE_ALL, BELOW_ALL, compareKeys } from './order.js';
import type { KeyPart } from './order.js';

/**
 * The PEP 440 grammar, transcribed from the specification's own regular
 * expression. Written to accept the same strings `packaging.version.Version`
 * accepts, including the leading `v`, surrounding whitespace, and the implicit
 * post release spelling `1.0-1`.
 */
const PEP440 =
  /^\s*v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(alpha|a|beta|b|preview|pre|c|rc)[-_.]?(\d+)?)?(?:(?:-(\d+))|(?:[-_.]?(post|rev|r)[-_.]?(\d+)?))?(?:[-_.]?(dev)[-_.]?(\d+)?)?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?\s*$/i;

const PRE_LETTERS: ReadonlyMap<string, string> = new Map([
  ['alpha', 'a'],
  ['a', 'a'],
  ['beta', 'b'],
  ['b', 'b'],
  ['c', 'rc'],
  ['pre', 'rc'],
  ['preview', 'rc'],
  ['rc', 'rc'],
]);

export interface Pep440Version {
  readonly epoch: number;
  readonly release: readonly number[];
  readonly pre: readonly [string, number] | null;
  readonly post: number | null;
  readonly dev: number | null;
  readonly local: readonly (number | string)[] | null;
}

/**
 * Parses a PEP 440 version.
 *
 * @param value - The version string, in any of the spellings PEP 440 normalizes.
 * @returns The parsed version, or null when the string is not a PEP 440 version.
 */
export function parsePep440(value: string): Pep440Version | null {
  const match = PEP440.exec(value);
  if (match === null) return null;

  const [
    ,
    epoch = '',
    // The release group is not optional in the pattern, so a match guarantees it.
    release = '',
    preLetter,
    preNumber,
    impliedPost,
    postLetter,
    postNumber,
    dev,
    devNumber,
    local,
  ] = match;

  return {
    epoch: epoch === '' ? 0 : Number(epoch),
    release: release.split('.').map(Number),
    pre:
      preLetter === undefined
        ? null
        : [PRE_LETTERS.get(preLetter.toLowerCase()) as string, toNumber(preNumber)],
    post:
      impliedPost !== undefined
        ? Number(impliedPost)
        : postLetter === undefined
          ? null
          : toNumber(postNumber),
    dev: dev === undefined ? null : toNumber(devNumber),
    local: local === undefined ? null : parseLocal(local),
  };
}

/**
 * Compares two PEP 440 versions.
 *
 * The ordering follows `packaging.version._cmpkey`: trailing zeros in the
 * release segment are dropped, a bare dev release sorts below every pre release,
 * an absent pre release sorts above every pre release, and a local version sorts
 * above the same version without one. Inside a local version, string segments
 * sort below numeric ones.
 *
 * @param a - Left version.
 * @param b - Right version.
 * @returns Negative when a is lower, positive when b is, zero when equal.
 * @throws Error when either string is not a PEP 440 version.
 */
export function comparePep440(a: string, b: string): number {
  const left = parsePep440(a);
  if (left === null) {
    throw new Error(
      `comparePep440: ${JSON.stringify(a)} is not a PEP 440 version; PyPI versions are epoch, release, and optional pre, post, dev, and local segments, so fix the lockfile or record the comparison as unevaluated`,
    );
  }
  const right = parsePep440(b);
  if (right === null) {
    throw new Error(
      `comparePep440: ${JSON.stringify(b)} is not a PEP 440 version; PyPI versions are epoch, release, and optional pre, post, dev, and local segments, so fix the lockfile or record the comparison as unevaluated`,
    );
  }
  return compareKeys(comparisonKey(left), comparisonKey(right));
}

/**
 * Builds the PEP 440 comparison key for a parsed version.
 *
 * @param version - The parsed version.
 * @returns The key, comparable with {@link compareKeys}.
 */
export function comparisonKey(version: Pep440Version): readonly KeyPart[] {
  const release = [...version.release];
  while (release.at(-1) === 0) release.pop();

  let pre: KeyPart;
  if (version.pre === null && version.post === null && version.dev !== null) pre = BELOW_ALL;
  else if (version.pre === null) pre = ABOVE_ALL;
  else pre = [version.pre[0], version.pre[1]];

  const post: KeyPart = version.post ?? BELOW_ALL;
  const dev: KeyPart = version.dev ?? ABOVE_ALL;

  const local: KeyPart =
    version.local === null
      ? BELOW_ALL
      : version.local.map((segment) =>
          typeof segment === 'number' ? [segment, ''] : [BELOW_ALL, segment],
        );

  return [version.epoch, release, pre, post, dev, local];
}

function parseLocal(local: string): (number | string)[] {
  return local
    .toLowerCase()
    .split(/[-_.]/)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function toNumber(value: string | undefined): number {
  return value === undefined ? 0 : Number(value);
}
