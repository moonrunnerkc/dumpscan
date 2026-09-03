export interface ParsedArgs {
  /** The subcommand, or null when none was given. */
  readonly command: string | null;
  /** Positional arguments after the subcommand. */
  readonly positional: readonly string[];
  /** Long options. A flag with no value is recorded as an empty string. */
  readonly options: ReadonlyMap<string, string>;
  /** Long options that may repeat, such as --ecosystems. */
  readonly repeated: ReadonlyMap<string, readonly string[]>;
}

/**
 * Parses the dumpscan command line.
 *
 * Deliberately small: long options only, `--name value` or `--name=value`, and
 * `--` to stop parsing. There is no short flag aliasing and no implicit boolean
 * negation, because a scanner whose output is a signed claim should not have two
 * spellings for the same run.
 *
 * @param argv - Arguments after the program name.
 * @returns The command, its positional arguments, and its options.
 * @throws Error when an option is written in a form this parser does not accept.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  let command: string | null = null;
  let literal = false;

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i] as string;

    if (literal || !argument.startsWith('-')) {
      if (command === null && !literal) command = argument;
      else positional.push(argument);
      continue;
    }

    if (argument === '--') {
      literal = true;
      continue;
    }

    if (!argument.startsWith('--')) {
      throw new Error(
        `dumpscan: ${JSON.stringify(argument)} is not an option dumpscan accepts; every option is spelled --name`,
      );
    }

    const equals = argument.indexOf('=');
    const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
    let value: string;
    if (equals !== -1) {
      value = argument.slice(equals + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        value = '';
      } else {
        value = next;
        i += 1;
      }
    }

    options.set(name, value);
    const bucket = repeated.get(name) ?? [];
    bucket.push(value);
    repeated.set(name, bucket);
  }

  return { command, positional, options, repeated };
}

/**
 * Reads a required option.
 *
 * @param args - Parsed arguments.
 * @param name - Option name without the dashes.
 * @param why - What the option is for, used in the error message.
 * @returns The value.
 * @throws Error when the option is absent or empty.
 */
export function requireOption(args: ParsedArgs, name: string, why: string): string {
  const value = args.options.get(name);
  if (value === undefined || value === '') {
    throw new Error(`dumpscan: --${name} is required; ${why}`);
  }
  return value;
}

/**
 * Reads a flag, which is present with no value or with an explicit `true`.
 *
 * @param args - Parsed arguments.
 * @param name - Option name without the dashes.
 * @returns Whether the flag was given.
 */
export function flag(args: ParsedArgs, name: string): boolean {
  const value = args.options.get(name);
  return value === '' || value === 'true';
}
