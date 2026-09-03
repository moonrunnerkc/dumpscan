export interface CommandOutput {
  readonly exitCode: number;
  /** Lines printed when --json was not given. */
  readonly lines: readonly string[];
  /** The machine readable report printed under --json. */
  readonly json: unknown;
}

/**
 * Prints a command's result in whichever form the caller asked for.
 *
 * @param output - The command result.
 * @param asJson - Whether --json was given.
 * @param write - Where to write, defaulting to standard output.
 */
export function print(
  output: CommandOutput,
  asJson: boolean,
  write: (line: string) => void = console.log,
): void {
  if (asJson) write(JSON.stringify(output.json, null, 2));
  else for (const line of output.lines) write(line);
}
