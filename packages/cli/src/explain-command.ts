import { existsSync, readFileSync } from 'node:fs';

import { parseJson } from '@dumpscan/canon';
import { explainAgainst, explainToJson, parseExternalReport } from '@dumpscan/explain';

import type { ParsedArgs } from './args.js';
import { readBundle } from './bundle-io.js';
import { EXIT_FINDINGS, EXIT_OK, UsageError } from './exit.js';
import type { CommandOutput } from './output.js';

/**
 * Runs `dumpscan explain`.
 *
 * Ingests Grype or Trivy JSON, aligns it to the manifest dumpscan scanned, and
 * buckets every disagreement as an identifier mismatch, a feed difference, a
 * range interpretation, or a suppression.
 *
 * The output is never signed. It is a claim about another tool's behaviour, not
 * about the code being scanned, and signing it would give it a standing it has
 * not earned.
 *
 * @param args - Parsed arguments.
 * @returns Exit code, human lines, and the bucketed report.
 * @throws UsageError when a path is missing or does not exist.
 */
export function runExplain(args: ParsedArgs): CommandOutput {
  const bundlePath = args.positional[0];
  const reportPath = args.positional[1];
  if (bundlePath === undefined || reportPath === undefined) {
    throw new UsageError(
      'dumpscan explain needs a bundle and a scanner report; run dumpscan explain <bundle> <grype-or-trivy-json>',
    );
  }
  if (!existsSync(reportPath)) {
    throw new UsageError(`dumpscan explain: ${reportPath} does not exist`);
  }

  const bundle = readBundle(bundlePath);
  const external = parseExternalReport(parseJson(readFileSync(reportPath, 'utf8')), reportPath);
  const result = explainAgainst(bundle.manifest, bundle.findings, external);

  const lines = [
    `scanner              ${result.scanner}`,
    `agreed               ${String(result.agreed.length)}`,
    `identifier mismatch  ${String(result.counts['identifier-mismatch'])}`,
    `feed difference      ${String(result.counts['feed-difference'])}`,
    `range interpretation ${String(result.counts['range-interpretation'])}`,
    `suppression          ${String(result.counts.suppression)}`,
  ];

  if (result.discrepancies.length > 0) {
    lines.push('');
    for (const entry of result.discrepancies) {
      lines.push(`  ${entry.bucket.padEnd(21)}${entry.purl} ${entry.advisory}`);
      lines.push(`  ${' '.repeat(21)}${entry.detail}`);
    }
  }
  lines.push('', 'this report is a diagnostic and is never signed');

  return {
    exitCode: result.discrepancies.length > 0 ? EXIT_FINDINGS : EXIT_OK,
    lines,
    json: { bundle: bundlePath, report: reportPath, ...explainToJson(result) },
  };
}
