import { compareCodeUnits } from '@dumpscan/canon';

import { compareDigitStrings } from './order.js';

/**
 * Qualifier order, from Maven's `ComparableVersion`. The empty string is the
 * release itself, so everything before it is a prerelease and `sp` is a service
 * pack that comes after.
 */
const QUALIFIERS = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp'];

/** A qualifier Maven does not know sorts after every one it does. */
const UNKNOWN_PREFIX = `${QUALIFIERS.length}-`;

/** The comparable form of the release qualifier, which absent items compare against. */
const RELEASE = String(QUALIFIERS.indexOf(''));

const ALIASES = new Map([
  ['ga', ''],
  ['final', ''],
  ['release', ''],
  ['cr', 'rc'],
]);

const SINGLE_LETTER = new Map([
  ['a', 'alpha'],
  ['b', 'beta'],
  ['m', 'milestone'],
]);

type Item =
  | { readonly kind: 'int'; readonly value: string }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'list'; readonly items: Item[] };

/**
 * Parses a Maven version into the item tree `ComparableVersion` compares.
 *
 * Every string is a Maven version: the algorithm has no failure mode, which is
 * why Maven can order coordinates nobody planned for. `1.0-alpha-1` becomes a
 * list of `1`, `0`, and a nested list holding `alpha` and `1`.
 *
 * @param value - The version string.
 * @returns The parsed item tree.
 */
export function parseMavenVersion(value: string): Item {
  const version = value.toLowerCase();
  const root: Item = { kind: 'list', items: [] };
  const stack: Item[] = [root];
  let list = root;
  let isDigit = false;
  let start = 0;

  const push = (): void => {
    const next: Item = { kind: 'list', items: [] };
    (list as { items: Item[] }).items.push(next);
    stack.push(next);
    list = next;
  };
  const add = (item: Item): void => {
    (list as { items: Item[] }).items.push(item);
  };

  for (let i = 0; i < version.length; i += 1) {
    const character = version.charAt(i);
    if (character === '.') {
      add(i === start ? intItem('0') : parseItem(isDigit, version.slice(start, i)));
      start = i + 1;
    } else if (character === '-') {
      add(i === start ? intItem('0') : parseItem(isDigit, version.slice(start, i)));
      start = i + 1;
      push();
    } else if (character >= '0' && character <= '9') {
      if (!isDigit && i > start) {
        add(stringItem(version.slice(start, i), true));
        start = i;
        push();
      }
      isDigit = true;
    } else {
      if (isDigit && i > start) {
        add(parseItem(true, version.slice(start, i)));
        start = i;
        push();
      }
      isDigit = false;
    }
  }
  if (version.length > start) add(parseItem(isDigit, version.slice(start)));

  while (stack.length > 0) normalize(stack.pop() as Item);
  return root;
}

/**
 * Compares two Maven versions with the `ComparableVersion` algorithm.
 *
 * Trailing items that mean nothing are dropped, so `1`, `1.0`, and `1.0.0` are
 * the same version, and `1-ga` and `1-final` are the same as `1`.
 *
 * @param a - Left version.
 * @param b - Right version.
 * @returns Negative when a is lower, positive when b is, zero when equal.
 */
export function compareMavenVersion(a: string, b: string): number {
  return compareItems(parseMavenVersion(a), parseMavenVersion(b));
}

function parseItem(isDigit: boolean, buffer: string): Item {
  return isDigit ? intItem(buffer) : stringItem(buffer, false);
}

function intItem(buffer: string): Item {
  return { kind: 'int', value: buffer.replace(/^0+(?=\d)/, '') };
}

function stringItem(buffer: string, followedByDigit: boolean): Item {
  let value = buffer;
  if (followedByDigit && value.length === 1) value = SINGLE_LETTER.get(value) ?? value;
  return { kind: 'string', value: ALIASES.get(value) ?? value };
}

function normalize(item: Item): void {
  if (item.kind !== 'list') return;
  for (let i = item.items.length - 1; i >= 0; i -= 1) {
    const last = item.items[i] as Item;
    if (isNullItem(last)) item.items.splice(i, 1);
    else if (last.kind !== 'list') break;
  }
}

function isNullItem(item: Item): boolean {
  if (item.kind === 'int') return item.value === '0';
  if (item.kind === 'string') return comparableQualifier(item.value) === RELEASE;
  return item.items.length === 0;
}

function comparableQualifier(value: string): string {
  const index = QUALIFIERS.indexOf(value);
  return index === -1 ? `${UNKNOWN_PREFIX}${value}` : String(index);
}

function compareItems(left: Item, right: Item | null): number {
  switch (left.kind) {
    case 'int':
      return compareInt(left.value, right);
    case 'string':
      return compareString(left.value, right);
    default:
      return compareList(left.items, right);
  }
}

function compareInt(value: string, right: Item | null): number {
  if (right === null) return value === '0' ? 0 : 1;
  if (right.kind === 'int') return compareDigitStrings(value, right.value);
  return 1;
}

function compareString(value: string, right: Item | null): number {
  if (right === null) return compareCodeUnits(comparableQualifier(value), RELEASE);
  if (right.kind === 'int') return -1;
  if (right.kind === 'list') return 1;
  return compareCodeUnits(comparableQualifier(value), comparableQualifier(right.value));
}

function compareList(items: readonly Item[], right: Item | null): number {
  if (right === null) {
    const first = items[0];
    return first === undefined ? 0 : compareItems(first, null);
  }
  if (right.kind === 'int') return -1;
  if (right.kind === 'string') return 1;

  const length = Math.max(items.length, right.items.length);
  for (let i = 0; i < length; i += 1) {
    const l = items[i] ?? null;
    const r = right.items[i] ?? null;
    const result = l === null ? (r === null ? 0 : -compareItems(r, l)) : compareItems(l, r);
    if (result !== 0) return result;
  }
  return 0;
}
