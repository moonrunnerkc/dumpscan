import type { Finding } from '@dumpscan/match';
import type { ScanPredicate } from '@dumpscan/predicate';

/**
 * SARIF is derived output, never the source of truth. The bundle is the claim;
 * this is a rendering of it that GitHub code scanning knows how to display, so
 * it is written from the same findings the findings root covers rather than
 * from a second pass over anything.
 */
const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';

const LEVELS: Record<Finding['status'], string> = {
  affected: 'error',
  excluded: 'note',
  'withdrawn-suppressed': 'note',
  unevaluated: 'warning',
};

export interface SarifInput {
  readonly findings: readonly Finding[];
  readonly predicate: ScanPredicate;
  readonly inputDigest: string;
  readonly lockfile: string;
}

/**
 * Renders a scan as a SARIF 2.1.0 log.
 *
 * Every finding becomes a result, including the excluded, withdrawn, and
 * unevaluated ones, because dropping them here would show a reviewer a
 * different set from the one the findings root covers. Status decides the
 * level: affected is an error, unevaluated is a warning because nobody has
 * decided it yet, and a suppression is a note.
 *
 * @param input - The findings, the predicate they belong to, and the lockfile they came from.
 * @returns The SARIF log, ready to serialize.
 */
export function toSarif(input: SarifInput): Record<string, unknown> {
  const rules = new Map<string, Record<string, unknown>>();
  for (const finding of input.findings) {
    if (rules.has(finding.advisoryId)) continue;
    rules.set(finding.advisoryId, {
      id: finding.advisoryId,
      name: finding.advisoryId,
      shortDescription: { text: `${finding.advisoryId} affects ${finding.name}` },
      fullDescription: {
        text:
          finding.aliases.length > 0
            ? `${finding.advisoryId} (${finding.aliases.join(', ')})`
            : finding.advisoryId,
      },
      properties: {
        tags: ['security', finding.ecosystem],
        ...(finding.severity[0] === undefined ? {} : { severity: finding.severity[0].score }),
      },
    });
  }

  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'dumpscan',
            informationUri: 'https://dumpscan.dev',
            rules: [...rules.values()],
          },
        },
        results: input.findings.map((finding) => result(finding, input.lockfile)),
        properties: {
          feedDigest: input.predicate.feedDigest,
          findingsRoot: input.predicate.findingsRoot,
          comparatorRulesetDigest: input.predicate.comparatorRulesetDigest,
          exclusionsDigest: input.predicate.exclusionsDigest,
          inputDigest: input.inputDigest,
        },
      },
    ],
  };
}

function result(finding: Finding, lockfile: string): Record<string, unknown> {
  return {
    ruleId: finding.advisoryId,
    level: LEVELS[finding.status],
    message: { text: message(finding) },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: lockfile },
          region: { startLine: 1 },
        },
      },
    ],
    partialFingerprints: {
      dumpscanFinding: `${finding.ecosystem}:${finding.name}:${finding.version}:${finding.advisoryId}`,
    },
  };
}

function message(finding: Finding): string {
  const range = finding.matchedRange;
  const matched =
    range === null
      ? ''
      : ` Matched ${range.type} range introduced ${range.introduced ?? 'unknown'}${
          range.fixed === null ? '' : `, fixed ${range.fixed}`
        }.`;
  const reason = finding.reason === null ? '' : ` ${finding.reason}.`;
  return `${finding.purl} is ${finding.status} by ${finding.advisoryId}.${matched}${reason}`;
}
