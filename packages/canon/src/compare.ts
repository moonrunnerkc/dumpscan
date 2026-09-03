/**
 * Compares two strings by UTF-16 code unit, the ordering RFC 8785 requires for
 * object keys. JavaScript relational operators on strings are already defined
 * as code unit comparison, so this is a wrapper that names the intent and keeps
 * `localeCompare` out of the codebase.
 *
 * @param a - Left string.
 * @param b - Right string.
 * @returns Negative when a sorts first, positive when b does, zero when equal.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compares two byte strings lexicographically, shorter first on a common prefix.
 *
 * @param a - Left bytes.
 * @param b - Right bytes.
 * @returns Negative when a sorts first, positive when b does, zero when equal.
 */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const left = a[i] as number;
    const right = b[i] as number;
    if (left !== right) return left < right ? -1 : 1;
  }
  return a.length - b.length;
}
