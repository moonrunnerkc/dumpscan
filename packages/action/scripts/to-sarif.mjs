// Converts a dumpscan --json scan report to SARIF 2.1.0 for code scanning.
// SARIF is derived and never the source of truth: the bundle is the claim, and
// this file is a rendering of it that GitHub knows how to display.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (input === undefined || output === undefined) {
  console.error('usage: node to-sarif.mjs <scan.json> <out.sarif>');
  process.exit(2);
}

const report = JSON.parse(readFileSync(input, 'utf8'));
const findings = report.findings ?? [];

const LEVELS = {
  affected: 'error',
  excluded: 'note',
  'withdrawn-suppressed': 'note',
  unevaluated: 'warning',
};

const rules = new Map();
for (const finding of findings) {
  if (rules.has(finding.advisoryId)) continue;
  rules.set(finding.advisoryId, {
    id: finding.advisoryId,
    name: finding.advisoryId,
    shortDescription: { text: `${finding.advisoryId} affects ${finding.name}` },
    fullDescription: {
      text: `${finding.advisoryId}${finding.aliases.length > 0 ? ` (${finding.aliases.join(', ')})` : ''}`,
    },
    properties: {
      tags: ['security', finding.ecosystem],
      ...(finding.severity.length > 0 ? { severity: finding.severity[0].score } : {}),
    },
  });
}

const results = findings.map((finding) => ({
  ruleId: finding.advisoryId,
  level: LEVELS[finding.status] ?? 'warning',
  message: {
    text: [
      `${finding.purl} is ${finding.status} by ${finding.advisoryId}.`,
      finding.matchedRange === null
        ? ''
        : ` Matched ${finding.matchedRange.type} range introduced ${finding.matchedRange.introduced ?? 'unknown'}${
            finding.matchedRange.fixed === null ? '' : `, fixed ${finding.matchedRange.fixed}`
          }.`,
      finding.reason === null ? '' : ` ${finding.reason}.`,
    ].join(''),
  },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: report.lockfile ?? 'lockfile' },
        region: { startLine: 1 },
      },
    },
  ],
  partialFingerprints: {
    dumpscanFinding: `${finding.ecosystem}:${finding.name}:${finding.version}:${finding.advisoryId}`,
  },
}));

const sarif = {
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
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
      results,
      properties: {
        feedDigest: report.statement?.predicate?.feedDigest ?? null,
        findingsRoot: report.statement?.predicate?.findingsRoot ?? null,
        comparatorRulesetDigest: report.statement?.predicate?.comparatorRulesetDigest ?? null,
        exclusionsDigest: report.statement?.predicate?.exclusionsDigest ?? null,
        inputDigest: report.inputDigest ?? null,
      },
    },
  ],
};

writeFileSync(output, `${JSON.stringify(sarif, null, 2)}\n`);
console.log(`wrote ${output} with ${results.length} result(s)`);
