/**
 * Normalizes a string to Unicode NFC. Every string dumpscan hashes goes through
 * this first, so a package name written with a precomposed character and one
 * written with a combining sequence produce the same digest.
 *
 * Normalization is defined by the Unicode standard and does not consult the
 * locale, unlike `toLocaleLowerCase` and friends.
 *
 * @param value - Any string.
 * @returns The NFC form of the string.
 */
export function normalizeNfc(value: string): string {
  return value.normalize('NFC');
}
