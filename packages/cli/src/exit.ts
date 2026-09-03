/** Everything checked out. */
export const EXIT_OK = 0;

/** Findings are present, or a replay or verification did not match. */
export const EXIT_FINDINGS = 1;

/** The command line was wrong. */
export const EXIT_USAGE = 2;

/** A diff found a changed finding it could not attribute to any input. */
export const EXIT_UNEXPLAINED = 3;

/**
 * Raised when the command line is wrong. Distinct from every other error so the
 * CLI can exit 2 rather than 1, which is what a caller scripting dumpscan needs
 * to tell "you asked wrong" from "the answer is bad news".
 */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

/**
 * Renders an error and everything that caused it.
 *
 * Errors are rethrown with `{ cause }` throughout dumpscan, and the cause is
 * usually the only part that says what actually went wrong: "Sigstore signing
 * failed" is a category, and the cause underneath it is the reason. Dropping it
 * leaves a caller with a message they cannot act on.
 *
 * @param error - The thrown value.
 * @returns The message, followed by one indented line per cause.
 */
export function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return describe(error);
  const chain: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    chain.push(current.message);
    current = current.cause;
  }
  // A cause that is not an Error still says something. A cycle stops above.
  if (current !== undefined && current !== null && !seen.has(current)) {
    chain.push(describe(current));
  }
  return chain.join('\n  caused by: ');
}

/**
 * Renders a thrown value that is not an Error.
 *
 * Objects go through JSON rather than String, because `[object Object]` is the
 * kind of message this function exists to stop printing.
 *
 * @param value - The thrown value or cause.
 * @returns Something a reader can act on.
 */
function describe(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    try {
      return toJson(value) ?? Object.prototype.toString.call(value);
    } catch {
      // Circular, or a toJSON that throws. The type tag is still worth printing.
      return Object.prototype.toString.call(value);
    }
  }
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[function ${value.name}]`;
  return String(value);
}

/**
 * JSON for a value, or undefined when it does not serialize to any.
 *
 * The lib signature says `string`, but `JSON.stringify` returns undefined for a
 * value whose `toJSON` returns undefined. The return type here is the honest one.
 *
 * @param value - The object to serialize.
 * @returns The JSON, or undefined.
 */
function toJson(value: object): string | undefined {
  return JSON.stringify(value);
}
