import { canonicalBytes, digest, parseJson } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { inputDigest, manifestToJson } from '@dumpscan/lockfiles';
import { findingsRoot, findingToJson } from '@dumpscan/match';
import { INPUT_MANIFEST_SUBJECT, statementToJson, subjectDigest } from '@dumpscan/predicate';

import type { ScanBundle } from './bundle.js';
import { envelopePayload, INTOTO_PAYLOAD_TYPE, verifyPlainKey } from './dsse.js';

export type CheckName =
  | 'findings-root'
  | 'findings-count'
  | 'input-manifest'
  | 'lockfile-subject'
  | 'signature'
  | 'payload-binding'
  | 'identity';

export interface Check {
  readonly name: CheckName;
  readonly passed: boolean;
  readonly detail: string;
}

export interface VerifyResult {
  readonly checks: readonly Check[];
  readonly passed: boolean;
  /** True when the bundle carries no attestation, so only the digests were checked. */
  readonly unsigned: boolean;
}

/**
 * Checks everything about a bundle that does not need the network.
 *
 * Verification never re-scans: it recomputes digests over what the bundle
 * carries and compares them to what the statement claims. A pass means the
 * findings in the file are the findings the signature covers, not that the
 * findings are still true.
 *
 * @param bundle - The bundle to check.
 * @returns One entry per check, and whether all of them passed.
 */
export function verifyBundleOffline(bundle: ScanBundle): VerifyResult {
  const checks: Check[] = [];
  const predicate = bundle.statement.predicate;

  const recomputedRoot = findingsRoot(bundle.findings);
  checks.push({
    name: 'findings-root',
    passed: recomputedRoot === predicate.findingsRoot,
    detail:
      recomputedRoot === predicate.findingsRoot
        ? `findings hash to ${recomputedRoot}`
        : `findings hash to ${recomputedRoot}, and the predicate claims ${predicate.findingsRoot}`,
  });

  checks.push({
    name: 'findings-count',
    passed: bundle.findings.length === predicate.findingsCount,
    detail: `bundle carries ${bundle.findings.length} findings, and the predicate claims ${predicate.findingsCount}`,
  });

  const manifestDigest = inputDigest(bundle.manifest);
  const claimedInput = subjectDigest(bundle.statement, INPUT_MANIFEST_SUBJECT);
  checks.push({
    name: 'input-manifest',
    passed: claimedInput === manifestDigest,
    detail:
      claimedInput === manifestDigest
        ? `input manifest hashes to ${manifestDigest}`
        : `input manifest hashes to ${manifestDigest}, and the subject claims ${claimedInput ?? 'nothing'}`,
  });

  const lockfileSubject = bundle.statement.subject.find(
    (subject) => subject.name !== INPUT_MANIFEST_SUBJECT,
  );
  const claimedLockfile: Digest | null =
    lockfileSubject === undefined ? null : `sha256:${lockfileSubject.digest.sha256}`;
  checks.push({
    name: 'lockfile-subject',
    passed: claimedLockfile === bundle.manifest.lockfileDigest,
    detail:
      claimedLockfile === bundle.manifest.lockfileDigest
        ? `raw lockfile digest ${bundle.manifest.lockfileDigest} matches the subject`
        : `manifest records lockfile digest ${bundle.manifest.lockfileDigest}, and the subject claims ${claimedLockfile ?? 'nothing'}`,
  });

  if (bundle.attestation === null) {
    return { checks, passed: checks.every((check) => check.passed), unsigned: true };
  }

  if (bundle.attestation.kind === 'plain-key') {
    const { envelope, publicKeyPem } = bundle.attestation;
    const signed = verifyPlainKey(envelope, publicKeyPem);
    checks.push({
      name: 'signature',
      passed: signed,
      detail: signed
        ? 'the DSSE envelope verifies under the plain key it carries'
        : 'the DSSE envelope does not verify under the plain key it carries',
    });
    checks.push(bindingCheck(bundle, envelopePayload(envelope), envelope.payloadType));
    checks.push({
      name: 'identity',
      passed: false,
      detail:
        'this bundle was signed with a plain key, which binds it to no identity; only a keyless signature proves who produced the scan',
    });
    return { checks, passed: checks.every((check) => check.passed), unsigned: false };
  }

  return { checks, passed: checks.every((check) => check.passed), unsigned: false };
}

/**
 * Checks that a signed payload is the statement the bundle carries.
 *
 * A signature over some other statement is worthless here even when it is a
 * valid signature, so the payload is canonicalized and compared to the statement
 * rather than trusted because it parsed.
 *
 * @param bundle - The bundle.
 * @param payload - The signed payload bytes.
 * @param payloadType - The DSSE payload type.
 * @returns The binding check.
 */
export function bindingCheck(bundle: ScanBundle, payload: Uint8Array, payloadType: string): Check {
  return payloadBinding(canonicalBytes(statementToJson(bundle.statement)), payload, payloadType);
}

/**
 * Checks that a signature covers a specific set of canonical bytes.
 *
 * The scan statement and the snapshot statement are different documents with
 * different renderers, so the caller says which bytes the signature has to cover
 * rather than this deciding for it.
 *
 * @param expectedBytes - The canonical bytes the signature must cover.
 * @param payload - The signed payload bytes.
 * @param payloadType - The DSSE payload type.
 * @returns The binding check.
 */
export function payloadBinding(
  expectedBytes: Uint8Array,
  payload: Uint8Array,
  payloadType: string,
): Check {
  if (payloadType !== INTOTO_PAYLOAD_TYPE) {
    return {
      name: 'payload-binding',
      passed: false,
      detail: `the signature covers payload type ${payloadType}, and dumpscan signs ${INTOTO_PAYLOAD_TYPE}`,
    };
  }

  const expected = digest(expectedBytes);
  let actual: Digest;
  try {
    actual = digest(canonicalBytes(parseJson(new TextDecoder().decode(payload))));
  } catch {
    return {
      name: 'payload-binding',
      passed: false,
      detail: 'the signed payload is not JSON, so it cannot be the statement in this bundle',
    };
  }

  return {
    name: 'payload-binding',
    passed: actual === expected,
    detail:
      actual === expected
        ? `the signature covers the statement in this bundle (${expected})`
        : `the signature covers ${actual}, and the statement in this bundle is ${expected}`,
  };
}

/**
 * Renders the check results as lines a person can read.
 *
 * @param result - The verification result.
 * @returns One line per check.
 */
export function describeChecks(result: VerifyResult): string[] {
  return result.checks.map(
    (check) => `${check.passed ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`,
  );
}

/**
 * Recomputes the findings root of a bundle, for callers that want the value
 * rather than the check.
 *
 * @param bundle - The bundle.
 * @returns The root over the findings the bundle carries.
 */
export function recomputeFindingsRoot(bundle: ScanBundle): Digest {
  return findingsRoot(bundle.findings);
}

/**
 * Renders a bundle's manifest and findings the way the bundle file does, so a
 * caller can diff two bundles without reaching into either package.
 *
 * @param bundle - The bundle.
 * @returns The rendered manifest and findings.
 */
export function renderContents(bundle: ScanBundle): {
  manifest: ReturnType<typeof manifestToJson>;
  findings: ReturnType<typeof findingToJson>[];
} {
  return {
    manifest: manifestToJson(bundle.manifest),
    findings: bundle.findings.map(findingToJson),
  };
}
