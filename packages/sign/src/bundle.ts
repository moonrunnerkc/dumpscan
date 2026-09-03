import { canonicalBytes, isJsonArray, isJsonObject, parseJson } from '@dumpscan/canon';
import type { JsonObject, JsonValue } from '@dumpscan/canon';
import type { InputManifest } from '@dumpscan/lockfiles';
import type { Finding } from '@dumpscan/match';
import { statementToJson } from '@dumpscan/predicate';
import type { ScanStatement } from '@dumpscan/predicate';

import { envelopeToJson, parseEnvelope } from './dsse.js';
import type { DsseEnvelope } from './dsse.js';

/** Version tag over the shape of a dumpscan scan bundle. */
export const BUNDLE_VERSION = 'dumpscan.bundle/v1';

/**
 * How a bundle was signed. `sigstore` carries the Sigstore bundle verbatim, so
 * anything that understands Sigstore can read it without knowing about dumpscan.
 * `plain-key` carries a bare DSSE envelope and the public key it verifies under,
 * and asserts no identity at all.
 */
export type Attestation =
  | { readonly kind: 'sigstore'; readonly bundle: JsonObject }
  | { readonly kind: 'plain-key'; readonly envelope: DsseEnvelope; readonly publicKeyPem: string };

export interface ScanBundle {
  readonly bundleVersion: string;
  readonly statement: ScanStatement;
  /** The canonical input manifest, so `replay` can re-match without the lockfile. */
  readonly manifest: InputManifest;
  readonly findings: readonly Finding[];
  readonly attestation: Attestation | null;
}

/**
 * Renders a bundle as the JSON written to disk.
 *
 * The findings and the manifest travel with the statement because the statement
 * only carries their digests, and a verifier that cannot see what was hashed can
 * check a digest but cannot read a report.
 *
 * @param bundle - The bundle.
 * @param renderManifest - Renderer for the input manifest.
 * @param renderFinding - Renderer for one finding.
 * @returns A plain JSON object.
 */
export function bundleToJson(
  bundle: ScanBundle,
  renderManifest: (manifest: InputManifest) => JsonObject,
  renderFinding: (finding: Finding) => JsonObject,
): JsonObject {
  return {
    bundleVersion: bundle.bundleVersion,
    statement: statementToJson(bundle.statement),
    manifest: renderManifest(bundle.manifest),
    findings: bundle.findings.map(renderFinding),
    attestation: attestationToJson(bundle.attestation),
  };
}

/**
 * Serializes a bundle to its canonical bytes.
 *
 * @param bundle - The bundle.
 * @param renderManifest - Renderer for the input manifest.
 * @param renderFinding - Renderer for one finding.
 * @returns The bytes to write.
 */
export function bundleBytes(
  bundle: ScanBundle,
  renderManifest: (manifest: InputManifest) => JsonObject,
  renderFinding: (finding: Finding) => JsonObject,
): Uint8Array {
  return canonicalBytes(bundleToJson(bundle, renderManifest, renderFinding));
}

function attestationToJson(attestation: Attestation | null): JsonValue {
  if (attestation === null) return null;
  if (attestation.kind === 'sigstore') {
    return { kind: 'sigstore', bundle: attestation.bundle };
  }
  return {
    kind: 'plain-key',
    envelope: envelopeToJson(attestation.envelope),
    publicKeyPem: attestation.publicKeyPem,
  };
}

/**
 * Reads the parts of a bundle file that this package owns. The manifest and the
 * findings come back as raw JSON so the caller can parse them with the packages
 * that define them, which keeps `sign` from having to know their shapes.
 *
 * @param text - The bundle file contents.
 * @param origin - Where it came from, used in error messages.
 * @returns The bundle version, statement JSON, manifest JSON, findings JSON, and
 * attestation.
 * @throws Error when the file is not a dumpscan bundle of a version this build
 * understands.
 */
export function readBundleParts(
  text: string,
  origin: string,
): {
  statement: JsonValue;
  manifest: JsonValue;
  findings: readonly JsonValue[];
  attestation: Attestation | null;
} {
  const document = parseJson(text);
  if (!isJsonObject(document)) {
    throw new Error(`readBundle: ${origin} is not a JSON object; expected a dumpscan scan bundle`);
  }
  if (document['bundleVersion'] !== BUNDLE_VERSION) {
    throw new Error(
      `readBundle: ${origin} declares bundleVersion ${JSON.stringify(document['bundleVersion'])}, and this build writes ${BUNDLE_VERSION}; use a dumpscan that matches the bundle`,
    );
  }

  const statement = document['statement'];
  const manifest = document['manifest'];
  const findings = document['findings'];
  if (statement === undefined || manifest === undefined || !isJsonArray(findings)) {
    throw new Error(
      `readBundle: ${origin} is missing statement, manifest, or findings; all three travel together so a verifier can see what was hashed`,
    );
  }

  return {
    statement,
    manifest,
    findings,
    attestation: parseAttestation(document['attestation'], origin),
  };
}

function parseAttestation(value: JsonValue | undefined, origin: string): Attestation | null {
  if (value === undefined || value === null) return null;
  if (!isJsonObject(value)) {
    throw new Error(`readBundle: ${origin} attestation is neither null nor an object`);
  }

  const kind = value['kind'];
  if (kind === 'sigstore') {
    const inner = value['bundle'];
    if (!isJsonObject(inner)) {
      throw new Error(`readBundle: ${origin} sigstore attestation has no bundle object`);
    }
    return { kind: 'sigstore', bundle: inner };
  }
  if (kind === 'plain-key') {
    const publicKeyPem = value['publicKeyPem'];
    if (typeof publicKeyPem !== 'string') {
      throw new Error(
        `readBundle: ${origin} plain-key attestation has no publicKeyPem; without it the signature cannot be checked at all`,
      );
    }
    const envelope = value['envelope'];
    if (envelope === undefined) {
      throw new Error(`readBundle: ${origin} plain-key attestation has no envelope`);
    }
    return {
      kind: 'plain-key',
      envelope: parseEnvelope(envelope, `${origin} attestation envelope`),
      publicKeyPem,
    };
  }
  throw new Error(
    `readBundle: ${origin} attestation kind ${JSON.stringify(kind)} is neither sigstore nor plain-key`,
  );
}
