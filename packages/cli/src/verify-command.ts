import { describeChecks, verifyBundleOffline, verifyKeyless } from '@dumpscan/sign';
import type { Check } from '@dumpscan/sign';

import type { ParsedArgs } from './args.js';
import { readBundle } from './bundle-io.js';
import { EXIT_FINDINGS, EXIT_OK, UsageError } from './exit.js';
import type { CommandOutput } from './output.js';

/**
 * Runs `dumpscan verify`.
 *
 * Verification recomputes digests over what the bundle carries and compares
 * them to what the signed statement claims. It never re-scans, so a pass means
 * the findings in the file are the findings the signature covers, not that they
 * are still true today.
 *
 * @param args - Parsed arguments.
 * @returns Exit code, human lines, and the machine readable report.
 * @throws UsageError when no bundle path was given.
 */
export async function runVerify(args: ParsedArgs): Promise<CommandOutput> {
  const bundlePath = args.positional[0];
  if (bundlePath === undefined) {
    throw new UsageError(
      'dumpscan verify needs a bundle path; run dumpscan verify <bundle> [--identity <pattern>] [--issuer <url>]',
    );
  }

  const bundle = readBundle(bundlePath);
  const offline = verifyBundleOffline(bundle);
  const checks: Check[] = [...offline.checks];

  if (bundle.attestation?.kind === 'sigstore') {
    const identity = args.options.get('identity');
    const issuer = args.options.get('issuer');
    const tufCachePath = args.options.get('tuf-cache');
    checks.push(
      ...(await verifyKeyless(bundle, {
        ...(identity === undefined || identity === '' ? {} : { identity }),
        ...(issuer === undefined || issuer === '' ? {} : { issuer }),
        ...(tufCachePath === undefined || tufCachePath === ''
          ? {}
          : { tufCachePath, tufForceCache: true }),
      })),
    );
  }

  const result = {
    checks,
    passed: checks.every((check) => check.passed),
    unsigned: offline.unsigned,
  };
  const lines = describeChecks(result);
  if (result.unsigned) {
    lines.push('note: this bundle carries no attestation, so only its digests were checked');
  }

  return {
    exitCode: result.passed ? EXIT_OK : EXIT_FINDINGS,
    lines,
    json: {
      bundle: bundlePath,
      passed: result.passed,
      unsigned: result.unsigned,
      findingsRoot: bundle.statement.predicate.findingsRoot,
      checks: result.checks,
    },
  };
}
