import { compareCodeUnits } from '@dumpscan/canon';
import type { JsonObject } from '@dumpscan/canon';
import type { InputManifest } from '@dumpscan/lockfiles';
import type { Finding } from '@dumpscan/match';

import type { ExternalFinding } from './external.js';

/**
 * Why the two tools disagree about one package and one advisory.
 *
 * `identifier-mismatch` means the external scanner named a package dumpscan's
 * manifest does not contain, which is what CPE guessing and a different name
 * normalization look like from the outside.
 * `feed-difference` means the advisory is in one database and not the other,
 * checked through aliases so a CVE and its GHSA count as one advisory.
 * `range-interpretation` means both tools have the advisory and the package and
 * disagree about whether this version falls in it.
 * `suppression` means dumpscan found it and reported it as excluded, withdrawn,
 * or unevaluated rather than affected.
 */
export type Disagreement =
  'identifier-mismatch' | 'feed-difference' | 'range-interpretation' | 'suppression';

export interface Agreement {
  readonly purl: string;
  readonly advisory: string;
}

export interface Discrepancy {
  readonly bucket: Disagreement;
  readonly side: 'dumpscan-only' | 'external-only';
  readonly purl: string;
  readonly advisory: string;
  readonly detail: string;
}

export interface ExplainResult {
  readonly scanner: string;
  readonly agreed: readonly Agreement[];
  readonly discrepancies: readonly Discrepancy[];
  readonly counts: Readonly<Record<Disagreement, number>>;
}

/**
 * Aligns an external scanner's findings against a dumpscan scan and buckets
 * every disagreement.
 *
 * This is a diagnostic. Its output is never signed, because it is a claim about
 * another tool's behaviour rather than about the code being scanned.
 *
 * @param manifest - The input manifest dumpscan scanned.
 * @param findings - dumpscan's findings.
 * @param external - The external scanner's findings.
 * @returns What both tools agree on, and every disagreement with its cause.
 */
export function explainAgainst(
  manifest: InputManifest,
  findings: readonly Finding[],
  external: readonly ExternalFinding[],
): ExplainResult {
  const known = new Set(manifest.packages.map((pkg) => pkg.purl));
  const byPurl = new Map<string, Set<string>>();
  for (const pkg of manifest.packages) byPurl.set(pkg.purl, new Set());

  const ours = new Map<string, Finding>();
  const ourIds = new Map<string, Set<string>>();
  for (const finding of findings) {
    for (const id of [finding.advisoryId, ...finding.aliases]) {
      ours.set(`${finding.purl}|${id}`, finding);
      const bucket = ourIds.get(finding.purl) ?? new Set<string>();
      bucket.add(id);
      ourIds.set(finding.purl, bucket);
    }
  }

  const agreed: Agreement[] = [];
  const discrepancies: Discrepancy[] = [];
  const seen = new Set<string>();

  for (const entry of external) {
    const purl = entry.purl;
    if (purl === null || !known.has(purl)) {
      discrepancies.push({
        bucket: 'identifier-mismatch',
        side: 'external-only',
        purl: purl ?? `${entry.name}@${entry.version}`,
        advisory: entry.id,
        detail: `${entry.scanner} matched ${entry.name} ${entry.version} on ${entry.matchedOn}, and that package is not in the input manifest`,
      });
      continue;
    }

    const ids = [entry.id, ...entry.aliases];
    const match = ids
      .map((id) => ours.get(`${purl}|${id}`))
      .find((finding) => finding !== undefined);

    if (match === undefined) {
      discrepancies.push({
        bucket: 'feed-difference',
        side: 'external-only',
        purl,
        advisory: entry.id,
        detail: `${entry.scanner} has ${entry.id} for this package and the pinned OSV snapshot has no advisory under that id or any of its aliases`,
      });
      continue;
    }

    seen.add(`${match.purl}|${match.advisoryId}`);
    if (match.status === 'affected') {
      agreed.push({ purl, advisory: match.advisoryId });
      continue;
    }
    discrepancies.push({
      bucket: 'suppression',
      side: 'external-only',
      purl,
      advisory: match.advisoryId,
      detail: `${entry.scanner} reports this and dumpscan reports it as ${match.status}${match.reason === null ? '' : `: ${match.reason}`}`,
    });
  }

  for (const finding of findings) {
    if (finding.status !== 'affected') continue;
    if (seen.has(`${finding.purl}|${finding.advisoryId}`)) continue;

    const externalIdsForPackage = new Set(
      external
        .filter((entry) => entry.purl === finding.purl)
        .flatMap((entry) => [entry.id, ...entry.aliases]),
    );
    const sawPackage = external.some((entry) => entry.purl === finding.purl);
    const sharesId = [finding.advisoryId, ...finding.aliases].some((id) =>
      externalIdsForPackage.has(id),
    );

    discrepancies.push({
      bucket: sawPackage && sharesId ? 'range-interpretation' : 'feed-difference',
      side: 'dumpscan-only',
      purl: finding.purl,
      advisory: finding.advisoryId,
      detail:
        sawPackage && sharesId
          ? `both tools have this advisory for this package and disagree about whether ${finding.version} falls in it`
          : `dumpscan has ${finding.advisoryId} for this package and the external scanner does not report it`,
    });
  }

  discrepancies.sort(
    (a, b) =>
      compareCodeUnits(a.bucket, b.bucket) ||
      compareCodeUnits(a.purl, b.purl) ||
      compareCodeUnits(a.advisory, b.advisory),
  );
  agreed.sort(
    (a, b) => compareCodeUnits(a.purl, b.purl) || compareCodeUnits(a.advisory, b.advisory),
  );

  return {
    scanner: external[0]?.scanner ?? 'unknown',
    agreed,
    discrepancies,
    counts: {
      'identifier-mismatch': count(discrepancies, 'identifier-mismatch'),
      'feed-difference': count(discrepancies, 'feed-difference'),
      'range-interpretation': count(discrepancies, 'range-interpretation'),
      suppression: count(discrepancies, 'suppression'),
    },
  };
}

/**
 * Renders an explain result as JSON.
 *
 * @param result - The result.
 * @returns A plain JSON object.
 */
export function explainToJson(result: ExplainResult): JsonObject {
  return {
    scanner: result.scanner,
    counts: { ...result.counts },
    agreed: result.agreed.map((entry) => ({ purl: entry.purl, advisory: entry.advisory })),
    discrepancies: result.discrepancies.map((entry) => ({
      bucket: entry.bucket,
      side: entry.side,
      purl: entry.purl,
      advisory: entry.advisory,
      detail: entry.detail,
    })),
  };
}

function count(discrepancies: readonly Discrepancy[], bucket: Disagreement): number {
  return discrepancies.filter((entry) => entry.bucket === bucket).length;
}
