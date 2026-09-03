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
