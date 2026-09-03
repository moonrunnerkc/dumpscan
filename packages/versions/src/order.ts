import { compareCodeUnits } from '@dumpscan/canon';

/** Sorts below every other key part. PEP 440 uses it for dev releases and absent post segments. */
export const BELOW_ALL: unique symbol = Symbol();

/** Sorts above every other key part. PEP 440 uses it for absent pre and dev segments. */
export const ABOVE_ALL: unique symbol = Symbol();

/**
 * A comparison key element. PEP 440 needs sentinels that sort below and above
 * every real value, so the key alphabet is wider than numbers and strings.
 */
export type KeyPart = number | string | readonly KeyPart[] | typeof BELOW_ALL | typeof ABOVE_ALL;

const RANK_BELOW = 0;
const RANK_NUMBER = 1;
const RANK_STRING = 2;
const RANK_LIST = 3;
const RANK_ABOVE = 4;

function rank(part: KeyPart): number {
  if (part === BELOW_ALL) return RANK_BELOW;
  if (part === ABOVE_ALL) return RANK_ABOVE;
  if (typeof part === 'number') return RANK_NUMBER;
  if (typeof part === 'string') return RANK_STRING;
  return RANK_LIST;
}

/**
 * Compares two comparison keys element by element. A shorter key that is a
 * prefix of a longer one sorts first, which is what makes `(1, 0)` and `(1)`
 * distinct without special casing.
 *
 * @param a - Left key.
 * @param b - Right key.
 * @returns Negative when a sorts first, positive when b does, zero when equal.
 */
export function compareKeys(a: readonly KeyPart[], b: readonly KeyPart[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const result = comparePart(a[i] as KeyPart, b[i] as KeyPart);
    if (result !== 0) return result;
  }
  return a.length - b.length;
}

function comparePart(a: KeyPart, b: KeyPart): number {
  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA !== rankB) return rankA - rankB;
  if (rankA === RANK_NUMBER) return compareNumbers(a as number, b as number);
  if (rankA === RANK_STRING) return compareCodeUnits(a as string, b as string);
  if (rankA === RANK_LIST) return compareKeys(a as readonly KeyPart[], b as readonly KeyPart[]);
  return 0;
}

function compareNumbers(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compares two strings of decimal digits as numbers, without going through a
 * float. A version component can exceed the safe integer range, and turning it
 * into a double would silently make two different versions compare equal.
 *
 * @param a - Left digit string.
 * @param b - Right digit string.
 * @returns Negative when a is smaller, positive when b is, zero when equal.
 */
export function compareDigitStrings(a: string, b: string): number {
  const left = stripLeadingZeros(a);
  const right = stripLeadingZeros(b);
  if (left.length !== right.length) return left.length - right.length;
  return compareCodeUnits(left, right);
}

// An all-zero string strips to the empty string, which is fine: it is shorter
// than every non-zero magnitude and equal to every other all-zero string, which
// is exactly how zero should compare.
function stripLeadingZeros(value: string): string {
  return value.replace(/^0+/, '');
}
