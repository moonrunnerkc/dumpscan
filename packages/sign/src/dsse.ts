import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

import { isJsonArray, isJsonObject } from '@dumpscan/canon';
import type { JsonObject, JsonValue } from '@dumpscan/canon';

/** The DSSE payload type dumpscan signs. */
export const INTOTO_PAYLOAD_TYPE = 'application/vnd.in-toto+json';

export interface DsseSignature {
  /** Base64 signature bytes. */
  readonly sig: string;
  /** Key hint. dumpscan uses the SHA-256 of the SPKI public key, in hex. */
  readonly keyid: string;
}

export interface DsseEnvelope {
  /** Base64 of the payload bytes. */
  readonly payload: string;
  readonly payloadType: string;
  readonly signatures: readonly DsseSignature[];
}

/**
 * Builds the DSSE Pre-Authentication Encoding.
 *
 * The signature covers this, not the raw payload, so a signature over an
 * in-toto statement cannot be replayed as a signature over some other payload
 * type that happens to have the same bytes.
 *
 * @param payloadType - The payload type string.
 * @param payload - The payload bytes.
 * @returns The PAE bytes.
 */
export function preAuthEncoding(payloadType: string, payload: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const type = encoder.encode(payloadType);
  const header = encoder.encode(
    `DSSEv1 ${String(type.length)} ${payloadType} ${String(payload.length)} `,
  );
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

export interface PlainKeyPair {
  /** PKCS#8 PEM. */
  readonly privateKeyPem: string;
  /** SPKI PEM. */
  readonly publicKeyPem: string;
  readonly keyid: string;
}

/**
 * Generates an ed25519 key pair for the explicit plain-key signing mode.
 *
 * Plain keys exist so a scan can be signed with no network and no identity
 * provider, in a test or on a machine that will never reach Fulcio. They carry
 * no identity, so `verify` says so rather than implying the guarantees keyless
 * signing gives.
 *
 * @returns The key pair and its key id.
 */
export function generatePlainKey(): PlainKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem,
    keyid: keyIdOf(publicKeyPem),
  };
}

/**
 * Computes the key id dumpscan records for a public key: the SHA-256 of its
 * DER encoded SPKI form, in lowercase hex.
 *
 * @param publicKeyPem - SPKI PEM.
 * @returns The key id.
 */
export function keyIdOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

/**
 * Derives the SPKI PEM public key from a PKCS#8 PEM private key, so a caller
 * that only holds the private key can still record what verifies against it.
 *
 * @param privateKeyPem - PKCS#8 PEM.
 * @returns SPKI PEM of the matching public key.
 */
export function publicKeyFromPrivate(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

/**
 * Signs a payload into a DSSE envelope with a plain ed25519 key.
 *
 * @param payload - The payload bytes, usually canonical statement JSON.
 * @param payloadType - The payload type.
 * @param privateKeyPem - PKCS#8 PEM of an ed25519 private key.
 * @returns The envelope.
 */
export function signPlainKey(
  payload: Uint8Array,
  payloadType: string,
  privateKeyPem: string,
): DsseEnvelope {
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, preAuthEncoding(payloadType, payload), key);
  return {
    payload: Buffer.from(payload).toString('base64'),
    payloadType,
    signatures: [
      {
        sig: signature.toString('base64'),
        keyid: keyIdOf(createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString()),
      },
    ],
  };
}

/**
 * Verifies a plain-key DSSE envelope.
 *
 * @param envelope - The envelope.
 * @param publicKeyPem - SPKI PEM of the expected signer.
 * @returns True when at least one signature verifies under the key.
 */
export function verifyPlainKey(envelope: DsseEnvelope, publicKeyPem: string): boolean {
  const key = createPublicKey(publicKeyPem);
  const payload = Buffer.from(envelope.payload, 'base64');
  const pae = preAuthEncoding(envelope.payloadType, payload);
  return envelope.signatures.some((signature) =>
    verify(null, pae, key, Buffer.from(signature.sig, 'base64')),
  );
}

/**
 * Decodes the payload of a DSSE envelope.
 *
 * @param envelope - The envelope.
 * @returns The payload bytes.
 */
export function envelopePayload(envelope: DsseEnvelope): Uint8Array {
  return Uint8Array.from(Buffer.from(envelope.payload, 'base64'));
}

/**
 * Renders an envelope as JSON for the bundle file.
 *
 * @param envelope - The envelope.
 * @returns A plain JSON object.
 */
export function envelopeToJson(envelope: DsseEnvelope): JsonObject {
  return {
    payload: envelope.payload,
    payloadType: envelope.payloadType,
    signatures: envelope.signatures.map((signature) => ({
      sig: signature.sig,
      keyid: signature.keyid,
    })),
  };
}

/**
 * Parses a DSSE envelope read back from a bundle.
 *
 * @param value - The parsed JSON.
 * @param origin - Where it came from, used in error messages.
 * @returns The envelope.
 * @throws Error when the value is not a DSSE envelope.
 */
export function parseEnvelope(value: JsonValue, origin: string): DsseEnvelope {
  if (!isJsonObject(value)) {
    throw new Error(`parseEnvelope: ${origin} is not a JSON object`);
  }
  const payload = value['payload'];
  const payloadType = value['payloadType'];
  const signatures = value['signatures'];
  if (typeof payload !== 'string' || typeof payloadType !== 'string' || !isJsonArray(signatures)) {
    throw new Error(
      `parseEnvelope: ${origin} is missing payload, payloadType, or signatures; a DSSE envelope needs all three`,
    );
  }
  return {
    payload,
    payloadType,
    signatures: signatures.map((entry, index) => {
      if (!isJsonObject(entry) || typeof entry['sig'] !== 'string') {
        throw new Error(`parseEnvelope: ${origin} signature ${index} has no sig`);
      }
      return {
        sig: entry['sig'],
        keyid: typeof entry['keyid'] === 'string' ? entry['keyid'] : '',
      };
    }),
  };
}
