import { readFileSync } from 'node:fs';

import type { JsonValue } from '@dumpscan/canon';
import { buildManifest, inputPackage } from '@dumpscan/lockfiles';
import type { InputManifest } from '@dumpscan/lockfiles';
import type { Ecosystem } from '@dumpscan/osv';
import { isEcosystem } from '@dumpscan/osv';
import { parseStatement } from '@dumpscan/predicate';
import { BUNDLE_VERSION, readBundleParts } from '@dumpscan/sign';
import type { ScanBundle } from '@dumpscan/sign';
import type { Finding, FindingStatus, MatchedRange } from '@dumpscan/match';

const STATUSES = new Set<string>(['affected', 'excluded', 'withdrawn-suppressed', 'unevaluated']);

/**
 * Reads a scan bundle from disk.
 *
 * The manifest and the findings are rebuilt through the same constructors that
 * produced them, so a bundle with a field the writer never emits is rejected
 * here rather than silently changing a recomputed digest later.
 *
 * @param path - Path to the bundle file.
 * @returns The bundle.
 * @throws Error when the file is not a dumpscan bundle this build understands.
 */
export function readBundle(path: string): ScanBundle {
  const parts = readBundleParts(readFileSync(path, 'utf8'), path);
  return {
    bundleVersion: BUNDLE_VERSION,
    statement: parseStatement(parts.statement, `${path} statement`),
    manifest: readManifest(parts.manifest, `${path} manifest`),
    findings: parts.findings.map((finding, index) =>
      readFinding(finding, `${path} findings[${index}]`),
    ),
    attestation: parts.attestation,
  };
}

/**
 * Parses a bundle file that has already been read into memory.
 *
 * @param text - The file contents.
 * @param origin - Where it came from, used in error messages.
 * @returns The bundle.
 */
export function parseBundle(text: string, origin: string): ScanBundle {
  const parts = readBundleParts(text, origin);
  return {
    bundleVersion: BUNDLE_VERSION,
    statement: parseStatement(parts.statement, `${origin} statement`),
    manifest: readManifest(parts.manifest, `${origin} manifest`),
    findings: parts.findings.map((finding, index) =>
      readFinding(finding, `${origin} findings[${index}]`),
    ),
    attestation: parts.attestation,
  };
}

function readManifest(value: JsonValue, origin: string): InputManifest {
  const record = asObject(value, origin);
  const packages = asArray(record['packages'], `${origin} packages`);
  return buildManifest({
    format: requireString(record['format'], `${origin} format`),
    lockfileDigest: requireString(record['lockfileDigest'], `${origin} lockfileDigest`) as never,
    workspaceRoot: requireString(record['workspaceRoot'], `${origin} workspaceRoot`),
    overApproximated: record['overApproximated'] === true,
    packages: packages.map((entry, index) => {
      const pkg = asObject(entry, `${origin} packages[${index}]`);
      return inputPackage(
        requireEcosystem(pkg['ecosystem'], `${origin} packages[${index}] ecosystem`),
        requireString(pkg['name'], `${origin} packages[${index}] name`),
        requireString(pkg['version'], `${origin} packages[${index}] version`),
      );
    }),
    unresolved: asArray(record['unresolved'] ?? [], `${origin} unresolved`).map((entry, index) =>
      requireString(entry, `${origin} unresolved[${index}]`),
    ),
  });
}

function readFinding(value: JsonValue, origin: string): Finding {
  const record = asObject(value, origin);
  const status = requireString(record['status'], `${origin} status`);
  if (!STATUSES.has(status)) {
    throw new Error(
      `readBundle: ${origin} status ${JSON.stringify(status)} is not a finding status`,
    );
  }
  const severity = asArray(record['severity'] ?? [], `${origin} severity`).map((entry, index) => {
    const item = asObject(entry, `${origin} severity[${index}]`);
    return {
      type: requireString(item['type'], `${origin} severity[${index}] type`),
      score: requireString(item['score'], `${origin} severity[${index}] score`),
    };
  });

  return {
    ecosystem: requireEcosystem(record['ecosystem'], `${origin} ecosystem`),
    name: requireString(record['name'], `${origin} name`),
    version: requireString(record['version'], `${origin} version`),
    purl: requireString(record['purl'], `${origin} purl`),
    advisoryId: requireString(record['advisoryId'], `${origin} advisoryId`),
    advisoryModified: requireString(record['advisoryModified'], `${origin} advisoryModified`),
    advisoryDigest: requireString(record['advisoryDigest'], `${origin} advisoryDigest`) as never,
    matchedRange: readRange(record['matchedRange'], `${origin} matchedRange`),
    aliases: asArray(record['aliases'] ?? [], `${origin} aliases`).map((entry, index) =>
      requireString(entry, `${origin} aliases[${index}]`),
    ),
    severity,
    status: status as FindingStatus,
    reason: typeof record['reason'] === 'string' ? record['reason'] : null,
  };
}

function readRange(value: JsonValue | undefined, origin: string): MatchedRange | null {
  if (value === undefined || value === null) return null;
  const record = asObject(value, origin);
  return {
    type: requireString(record['type'], `${origin} type`),
    introduced: optionalString(record['introduced']),
    fixed: optionalString(record['fixed']),
    lastAffected: optionalString(record['lastAffected']),
    limit: optionalString(record['limit']),
  };
}

function asObject(value: JsonValue | undefined, origin: string): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`readBundle: ${origin} is not a JSON object`);
  }
  return value as Record<string, JsonValue>;
}

function asArray(value: JsonValue | undefined, origin: string): readonly JsonValue[] {
  if (value === undefined || !Array.isArray(value)) {
    throw new Error(`readBundle: ${origin} is not an array`);
  }
  return value as readonly JsonValue[];
}

function requireString(value: JsonValue | undefined, origin: string): string {
  if (typeof value !== 'string') {
    throw new Error(`readBundle: ${origin} is not a string`);
  }
  return value;
}

function requireEcosystem(value: JsonValue | undefined, origin: string): Ecosystem {
  const name = requireString(value, origin);
  if (!isEcosystem(name)) {
    throw new Error(
      `readBundle: ${origin} is ${JSON.stringify(name)}, which dumpscan does not scan`,
    );
  }
  return name;
}

function optionalString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}
