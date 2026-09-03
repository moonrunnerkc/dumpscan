import { describe, expect, it } from 'vitest';

import {
  envelopePayload,
  envelopeToJson,
  generatePlainKey,
  INTOTO_PAYLOAD_TYPE,
  keyIdOf,
  parseEnvelope,
  preAuthEncoding,
  publicKeyFromPrivate,
  signPlainKey,
  verifyPlainKey,
} from './dsse.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const key = generatePlainKey();

describe('preAuthEncoding', () => {
  it('follows the DSSE v1 layout', () => {
    expect(decoder.decode(preAuthEncoding('http/x', encoder.encode('hello')))).toBe(
      'DSSEv1 6 http/x 5 hello',
    );
  });

  it('counts bytes, not characters', () => {
    // The euro sign is three bytes in UTF-8 and one JavaScript character.
    expect(decoder.decode(preAuthEncoding('t', encoder.encode('\u20ac')))).toBe(
      'DSSEv1 1 t 3 \u20ac',
    );
  });

  it('separates two payloads that would concatenate the same way', () => {
    const a = decoder.decode(preAuthEncoding('ab', encoder.encode('c')));
    const b = decoder.decode(preAuthEncoding('a', encoder.encode('bc')));
    expect(a).not.toBe(b);
  });
});

describe('generatePlainKey and keyIdOf', () => {
  it('produces a usable pair whose key id is the hash of the public key', () => {
    expect(key.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(key.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(key.keyid).toMatch(/^[0-9a-f]{64}$/);
    expect(keyIdOf(key.publicKeyPem)).toBe(key.keyid);
  });

  it('gives two keys different ids', () => {
    expect(generatePlainKey().keyid).not.toBe(key.keyid);
  });

  it('derives the public key from the private one', () => {
    expect(publicKeyFromPrivate(key.privateKeyPem)).toBe(key.publicKeyPem);
  });
});

describe('signPlainKey and verifyPlainKey', () => {
  const payload = encoder.encode('{"_type":"https://in-toto.io/Statement/v1"}');
  const envelope = signPlainKey(payload, INTOTO_PAYLOAD_TYPE, key.privateKeyPem);

  it('produces a DSSE envelope that verifies under its key', () => {
    expect(envelope.payloadType).toBe(INTOTO_PAYLOAD_TYPE);
    expect(envelope.signatures[0]?.keyid).toBe(key.keyid);
    expect(verifyPlainKey(envelope, key.publicKeyPem)).toBe(true);
  });

  it('round trips the payload', () => {
    expect(decoder.decode(envelopePayload(envelope))).toBe(decoder.decode(payload));
  });

  it('does not verify under a different key', () => {
    expect(verifyPlainKey(envelope, generatePlainKey().publicKeyPem)).toBe(false);
  });

  it('does not verify when the payload is swapped', () => {
    const swapped = { ...envelope, payload: Buffer.from('{"_type":"other"}').toString('base64') };
    expect(verifyPlainKey(swapped, key.publicKeyPem)).toBe(false);
  });

  it('does not verify when the payload type is swapped', () => {
    expect(verifyPlainKey({ ...envelope, payloadType: 'text/plain' }, key.publicKeyPem)).toBe(
      false,
    );
  });

  it('does not verify with no signatures at all', () => {
    expect(verifyPlainKey({ ...envelope, signatures: [] }, key.publicKeyPem)).toBe(false);
  });

  it('verifies when one of several signatures is the right one', () => {
    const extra = {
      ...envelope,
      signatures: [
        { sig: Buffer.from('nope').toString('base64'), keyid: 'x' },
        ...envelope.signatures,
      ],
    };
    expect(verifyPlainKey(extra, key.publicKeyPem)).toBe(true);
  });
});

describe('envelopeToJson and parseEnvelope', () => {
  const envelope = signPlainKey(encoder.encode('payload'), INTOTO_PAYLOAD_TYPE, key.privateKeyPem);

  it('round trips through JSON', () => {
    expect(parseEnvelope(envelopeToJson(envelope), 'test')).toStrictEqual(envelope);
  });

  it('defaults an absent keyid to the empty string rather than failing', () => {
    const parsed = parseEnvelope(
      { payload: 'eA==', payloadType: 't', signatures: [{ sig: 'eA==' }] },
      'test',
    );
    expect(parsed.signatures[0]?.keyid).toBe('');
  });

  it('refuses anything that is not a DSSE envelope', () => {
    expect(() => parseEnvelope([], 'test')).toThrow(/is not a JSON object/);
    expect(() => parseEnvelope({ payload: 'x' }, 'test')).toThrow(
      /missing payload, payloadType, or signatures/,
    );
    expect(() =>
      parseEnvelope({ payload: 'x', payloadType: 't', signatures: 'x' }, 'test'),
    ).toThrow(/missing payload, payloadType, or signatures/);
    expect(() =>
      parseEnvelope({ payload: 'x', payloadType: 't', signatures: [{}] }, 'test'),
    ).toThrow(/signature 0 has no sig/);
  });
});
