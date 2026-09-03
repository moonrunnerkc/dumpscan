import { flag, parseArgs } from './args.js';
import type { ParsedArgs } from './args.js';
import { EXIT_OK, EXIT_USAGE, messageOf, UsageError } from './exit.js';
import { HELP } from './help.js';
import { print } from './output.js';
import type { CommandOutput } from './output.js';
import { runDiff } from './diff-command.js';
import { runExplain } from './explain-command.js';
import { runProve } from './prove-command.js';
import { runPublish } from './publish-command.js';
import { runReplay } from './replay-command.js';
import { runScan } from './scan-command.js';
import { runSnapshot } from './snapshot-command.js';
import { runVerify } from './verify-command.js';

export type Writer = (line: string) => void;

/**
 * Runs one dumpscan invocation.
 *
 * @param argv - Arguments after the program name.
 * @param out - Where normal output goes.
 * @param err - Where errors go.
 * @returns The process exit code: 0 success, 1 findings or mismatch, 2 usage,
 * 3 unexplained divergence.
 */
export async function run(argv: readonly string[], out: Writer, err: Writer): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    err(messageOf(error));
    return EXIT_USAGE;
  }

  if (flag(args, 'version')) {
    out(VERSION);
    return EXIT_OK;
  }

  if (args.command === 'help' || flag(args, 'help')) {
    out(HELP);
    return EXIT_OK;
  }

  if (args.command === null) {
    out(HELP);
    return EXIT_USAGE;
  }

  try {
    const result = await dispatch(args.command, args);
    print(result, flag(args, 'json'), out);
    return result.exitCode;
  } catch (error) {
    // Both a wrong command line and a run that could not finish end here.
    // Neither produced a claim, and a caller can act on the message either way.
    err(messageOf(error));
    return EXIT_USAGE;
  }
}

/** Version of the dumpscan CLI. Kept in step with package.json by pnpm lint. */
export const VERSION = '1.0.0';

async function dispatch(command: string, args: ParsedArgs): Promise<CommandOutput> {
  switch (command) {
    case 'snapshot':
      return runSnapshot(args);
    case 'scan':
      return runScan(args);
    case 'verify':
      return runVerify(args);
    case 'prove':
      return runProve(args);
    case 'replay':
      return runReplay(args);
    case 'diff':
      return runDiff(args);
    case 'explain':
      return Promise.resolve(runExplain(args));
    case 'publish':
      return runPublish(args);
    default:
      throw new UsageError(
        `dumpscan: ${JSON.stringify(command)} is not a dumpscan command; run dumpscan --help`,
      );
  }
}

export { EXIT_OK, EXIT_USAGE, messageOf, UsageError } from './exit.js';
export { EXIT_FINDINGS, EXIT_UNEXPLAINED } from './exit.js';
export { parseArgs } from './args.js';
export type { ParsedArgs } from './args.js';
export { readBundle, parseBundle } from './bundle-io.js';
export {
  DEFAULT_CACHE_DIR,
  resolveSnapshot,
  resolveSnapshotWithStores,
  storesFrom,
} from './snapshot-resolver.js';
export { fetchSnapshot, INDEX_FILE, readStoreIndex } from './snapshot-fetch.js';
export { packSnapshot, unpackSnapshot } from './snapshot-archive.js';
export { HELP } from './help.js';
