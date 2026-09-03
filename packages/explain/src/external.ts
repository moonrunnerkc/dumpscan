import { compareCodeUnits, isJsonArray, isJsonObject } from '@dumpscan/canon';
import type { JsonObject, JsonValue } from '@dumpscan/canon';
import { purlFor } from '@dumpscan/lockfiles';
import { isEcosystem } from '@dumpscan/osv';
import type { Ecosystem } from '@dumpscan/osv';

/** Which scanner a report came from. */
export type Scanner = 'grype' | 'trivy';

export interface ExternalFinding {
  readonly scanner: Scanner;
  /** Vulnerability identifier as the scanner wrote it, usually a CVE or a GHSA. */
  readonly id: string;
  readonly aliases: readonly string[];
  readonly name: string;
  readonly version: string;
  /** The scanner's own purl when it had one, otherwise the one dumpscan derives. */
  readonly purl: string | null;
  readonly ecosystem: Ecosystem | null;
  /** The identifier kind the scanner matched on, which is where CPE guessing shows up. */
  readonly matchedOn: string;
  readonly severity: string;
}

const GRYPE_TYPES: ReadonlyMap<string, Ecosystem> = new Map([
  ['npm', 'npm'],
  ['python', 'PyPI'],
  ['rust-crate', 'crates.io'],
  ['go-module', 'Go'],
  ['java-archive', 'Maven'],
  ['jenkins-plugin', 'Maven'],
]);

const TRIVY_CLASSES: ReadonlyMap<string, Ecosystem> = new Map([
  ['npm', 'npm'],
  ['node-pkg', 'npm'],
  ['yarn', 'npm'],
  ['pnpm', 'npm'],
  ['pip', 'PyPI'],
  ['poetry', 'PyPI'],
  ['python-pkg', 'PyPI'],
  ['uv', 'PyPI'],
  ['cargo', 'crates.io'],
  ['gomod', 'Go'],
  ['gobinary', 'Go'],
  ['pom', 'Maven'],
  ['gradle', 'Maven'],
  ['jar', 'Maven'],
]);

/**
 * Reads a Grype or Trivy JSON report into one shape.
 *
 * The scanner is detected from the document rather than declared by the caller,
 * because a mislabelled report would produce a confident alignment against the
 * wrong fields.
 *
 * @param value - The parsed JSON of the report.
 * @param origin - Where it came from, used in error messages.
 * @returns The findings, ordered by package and identifier.
 * @throws Error when the document is neither scanner's output.
 */
export function parseExternalReport(value: JsonValue, origin: string): ExternalFinding[] {
  if (!isJsonObject(value)) {
    throw new Error(
      `parseExternalReport: ${origin} is not a JSON object; expected Grype or Trivy JSON output`,
    );
  }

  const findings = isJsonArray(value['matches'])
    ? readGrype(value['matches'])
    : isJsonArray(value['Results'])
      ? readTrivy(value['Results'])
      : null;

  if (findings === null) {
    throw new Error(
      `parseExternalReport: ${origin} has neither a Grype matches array nor a Trivy Results array; run grype -o json or trivy --format json and pass the output`,
    );
  }

  return findings.sort(
    (a, b) =>
      compareCodeUnits(a.name, b.name) ||
      compareCodeUnits(a.version, b.version) ||
      compareCodeUnits(a.id, b.id),
  );
}

function readGrype(matches: readonly JsonValue[]): ExternalFinding[] {
  const out: ExternalFinding[] = [];
  for (const entry of matches) {
    if (!isJsonObject(entry)) continue;
    const vulnerability = asObject(entry['vulnerability']);
    const artifact = asObject(entry['artifact']);
    const id = string(vulnerability['id']);
    const name = string(artifact['name']);
    const version = string(artifact['version']);
    if (id === null || name === null || version === null) continue;

    const ecosystem = GRYPE_TYPES.get(string(artifact['type']) ?? '') ?? null;
    out.push({
      scanner: 'grype',
      id,
      aliases: stringList(vulnerability['relatedVulnerabilities'], 'id'),
      name,
      version,
      purl: string(artifact['purl']) ?? derivePurl(ecosystem, name, version),
      ecosystem,
      matchedOn: grypeMatchedOn(entry),
      severity: string(vulnerability['severity']) ?? 'Unknown',
    });
  }
  return out;
}

function readTrivy(results: readonly JsonValue[]): ExternalFinding[] {
  const out: ExternalFinding[] = [];
  for (const result of results) {
    if (!isJsonObject(result)) continue;
    const ecosystem = TRIVY_CLASSES.get(string(result['Type']) ?? '') ?? null;
    const vulnerabilities = result['Vulnerabilities'];
    if (!isJsonArray(vulnerabilities)) continue;

    for (const entry of vulnerabilities) {
      if (!isJsonObject(entry)) continue;
      const id = string(entry['VulnerabilityID']);
      const name = string(entry['PkgName']);
      const version = string(entry['InstalledVersion']);
      if (id === null || name === null || version === null) continue;

      out.push({
        scanner: 'trivy',
        id,
        aliases: [
          ...stringArray(entry['VulnerabilityID']),
          ...stringArray(entry['Aliases']),
        ].filter((alias) => alias !== id),
        name,
        version,
        purl:
          string(asObject(entry['PkgIdentifier'])['PURL']) ?? derivePurl(ecosystem, name, version),
        ecosystem,
        matchedOn:
          string(entry['DataSource'] === undefined ? null : asObject(entry['DataSource'])['ID']) ??
          'package-name',
        severity: string(entry['Severity']) ?? 'UNKNOWN',
      });
    }
  }
  return out;
}

/**
 * Grype records which identifier it matched on inside `matchDetails`. A CPE
 * match is the single biggest source of cross-scanner divergence, so it is
 * carried through rather than flattened into "matched".
 */
function grypeMatchedOn(entry: JsonObject): string {
  const details = entry['matchDetails'];
  if (!isJsonArray(details)) return 'unknown';
  const kinds = details
    .map((detail) => (isJsonObject(detail) ? string(detail['type']) : null))
    .filter((kind): kind is string => kind !== null);
  return kinds.length === 0 ? 'unknown' : [...new Set(kinds)].sort(compareCodeUnits).join(', ');
}

function derivePurl(ecosystem: Ecosystem | null, name: string, version: string): string | null {
  if (ecosystem === null) return null;
  try {
    return purlFor(ecosystem, name, version);
  } catch {
    return null;
  }
}

function asObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}

function string(value: JsonValue | undefined | null): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function stringArray(value: JsonValue | undefined): string[] {
  if (!isJsonArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function stringList(value: JsonValue | undefined, key: string): string[] {
  if (!isJsonArray(value)) return [];
  return value
    .map((item) => (isJsonObject(item) ? string(item[key]) : null))
    .filter((item): item is string => item !== null)
    .sort(compareCodeUnits);
}

/**
 * Reports whether a string names an ecosystem dumpscan scans, for callers that
 * read an ecosystem out of an external report.
 *
 * @param value - Candidate ecosystem.
 * @returns True when dumpscan scans it.
 */
export function isKnownEcosystem(value: string): value is Ecosystem {
  return isEcosystem(value);
}
