import { isJsonObject, parseJson } from '@dumpscan/canon';
import type { JsonObject } from '@dumpscan/canon';
import * as sigstore from 'sigstore';

import { canonicalBytes } from '@dumpscan/canon';
import { statementToJson } from '@dumpscan/predicate';

import type { Attestation, ScanBundle } from './bundle.js';
import { INTOTO_PAYLOAD_TYPE } from './dsse.js';
import { payloadBinding } from './verify.js';
import type { Check } from './verify.js';

export interface KeylessSignOptions {
  /** OIDC token. In GitHub Actions this is the workflow token. */
  readonly identityToken?: string;
  readonly fulcioURL?: string;
  readonly rekorURL?: string;
  /** Set false to sign without a transparency log entry. Defaults to true. */
  readonly tlogUpload?: boolean;
}

export interface KeylessVerifyOptions {
  /** Expected certificate issuer, such as `https://token.actions.githubusercontent.com`. */
  readonly issuer?: string;
  /** Expected certificate identity, as a URI or an email address. */
  readonly identity?: string;
  /** Directory holding a cached Sigstore TUF root, for offline verification. */
  readonly tufCachePath?: string;
  /** Use the cached TUF root without refreshing it. */
  readonly tufForceCache?: boolean;
}

/**
 * Signs a statement keylessly and returns the Sigstore bundle.
 *
 * With an OIDC token in hand, sigstore-js takes the non-interactive path; with
 * none, it runs the interactive Fulcio flow. dumpscan does not decide between
 * them, it only passes through the token when there is one, so the behaviour
 * matches every other Sigstore client on the machine.
 *
 * @param payload - The canonical statement bytes.
 * @param options - Token and endpoint overrides.
 * @returns The Sigstore bundle as JSON.
 * @throws Error when signing fails, with the underlying cause attached.
 */
export async function signKeyless(
  payload: Uint8Array,
  options: KeylessSignOptions = {},
): Promise<Attestation> {
  try {
    const bundle = await sigstore.attest(Buffer.from(payload), INTOTO_PAYLOAD_TYPE, {
      ...(options.identityToken === undefined ? {} : { identityToken: options.identityToken }),
      ...(options.fulcioURL === undefined ? {} : { fulcioURL: options.fulcioURL }),
      ...(options.rekorURL === undefined ? {} : { rekorURL: options.rekorURL }),
      ...(options.tlogUpload === undefined ? {} : { tlogUpload: options.tlogUpload }),
    });
    return { kind: 'sigstore', bundle: parseJson(JSON.stringify(bundle)) as JsonObject };
  } catch (error) {
    throw new Error(
      'signKeyless: Sigstore signing failed; check that an OIDC token is available, or pass --key to sign with a plain key instead',
      { cause: error },
    );
  }
}

/**
 * Verifies the Sigstore attestation on a bundle and that it covers the
 * statement the bundle carries.
 *
 * Identity and issuer are checked when the caller names them. dumpscan does not
 * supply defaults: a signature that verifies against the Sigstore root but was
 * produced by an identity the caller never named proves the scan happened, not
 * that it happened where the caller expected.
 *
 * @param bundle - The bundle.
 * @param options - Identity, issuer, and TUF cache settings.
 * @returns The signature, payload binding, and identity checks.
 */
export async function verifyKeyless(
  bundle: ScanBundle,
  options: KeylessVerifyOptions = {},
): Promise<Check[]> {
  if (bundle.attestation?.kind !== 'sigstore') {
    return [
      {
        name: 'signature',
        passed: false,
        detail: 'this bundle carries no Sigstore attestation',
      },
    ];
  }
  return verifySigstoreBundle(
    bundle.attestation.bundle,
    canonicalBytes(statementToJson(bundle.statement)),
    options,
  );
}

/**
 * Verifies a Sigstore bundle and that it covers a specific set of bytes.
 *
 * Used for the scan attestation and for the snapshot attestation, which are
 * different statement types signed the same way.
 *
 * @param sigstoreBundle - The Sigstore bundle.
 * @param expectedBytes - The canonical bytes the signature has to cover.
 * @param options - Identity, issuer, and TUF cache settings.
 * @returns The signature, payload binding, and identity checks.
 */
export async function verifySigstoreBundle(
  sigstoreBundle: JsonObject,
  expectedBytes: Uint8Array,
  options: KeylessVerifyOptions = {},
): Promise<Check[]> {
  const checks: Check[] = [];
  try {
    await sigstore.verify(sigstoreBundle as never, {
      ...(options.issuer === undefined ? {} : { certificateIssuer: options.issuer }),
      ...(options.identity === undefined ? {} : identityOption(options.identity)),
      ...(options.tufCachePath === undefined ? {} : { tufCachePath: options.tufCachePath }),
      ...(options.tufForceCache === undefined ? {} : { tufForceCache: options.tufForceCache }),
    });
    checks.push({
      name: 'signature',
      passed: true,
      detail: 'the Sigstore bundle verifies against the trust root, including log inclusion',
    });
  } catch (error) {
    checks.push({
      name: 'signature',
      passed: false,
      detail: `the Sigstore bundle does not verify: ${error instanceof Error ? error.message : String(error)}`,
    });
    return checks;
  }

  checks.push(payloadBinding(expectedBytes, signedPayload(sigstoreBundle), INTOTO_PAYLOAD_TYPE));
  checks.push({
    name: 'identity',
    passed: options.issuer !== undefined && options.identity !== undefined,
    detail:
      options.issuer !== undefined && options.identity !== undefined
        ? `the certificate matches issuer ${options.issuer} and identity ${options.identity}`
        : 'no expected issuer and identity were given, so the signature proves a scan happened but not who produced it',
  });
  return checks;
}

function identityOption(identity: string): Record<string, string> {
  return identity.includes('@') && !identity.includes('://')
    ? { certificateIdentityEmail: identity }
    : { certificateIdentityURI: identity };
}

function signedPayload(bundle: JsonObject): Uint8Array {
  const envelope = bundle['dsseEnvelope'];
  if (!isJsonObject(envelope) || typeof envelope['payload'] !== 'string') {
    return new Uint8Array(0);
  }
  return Uint8Array.from(Buffer.from(envelope['payload'], 'base64'));
}
