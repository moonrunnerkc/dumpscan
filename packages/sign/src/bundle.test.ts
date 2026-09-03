import { canonicalJson, digest } from '@dumpscan/canon';
import type { JsonObject } from '@dumpscan/canon';
import { buildManifest, inputDigest, inputPackage, manifestToJson } from '@dumpscan/lockfiles';
import { findingsRoot, findingToJson } from '@dumpscan/match';
import type { Finding } from '@dumpscan/match';
import { buildStatement, statementToJson } from '@dumpscan/predicate';
import { describe, expect, it } from 'vitest';

import { BUNDLE_VERSION, bundleBytes, bundleToJson, readBundleParts } from './bundle.js';
import type { Attestation, ScanBundle } from './bundle.js';
import { generatePlainKey, INTOTO_PAYLOAD_TYPE, signPlainKey } from './dsse.js';
import {
  describeChecks,
  recomputeFindingsRoot,
  renderContents,
  verifyBundleOffline,
} from './verify.js';

const encoder = new TextEncoder();
const key = generatePlainKey();

const manifest = buildManifest({
  format: 'test',
  lockfileDigest: digest(encoder.encode('lockfile')),
  workspaceRoot: '.',
  overApproximated: false,
  packages: [inputPackage('npm', 'widget', '1.0.0')],
  unresolved: [],
});

const finding: Finding = {
  ecosystem: 'npm',
  name: 'widget',
  version: '1.0.0',
  purl: 'pkg:npm/widget@1.0.0',
  advisoryId: 'DUMPSCAN-1',
  advisoryModified: '2025-01-01T00:00:00Z',
  advisoryDigest: digest(encoder.encode('advisory')),
  matchedRange: null,
  aliases: [],
  severity: [],
  status: 'affected',
  reason: null,
};

function bundleWith(
  attestation: Attestation | null,
  findings: readonly Finding[] = [finding],
): ScanBundle {
  const statement = buildStatement({
    inputDigest: inputDigest(manifest),
    lockfileDigest: manifest.lockfileDigest,
    lockfileName: 'package-lock.json',
    predicate: {
      feedDigest: digest(encoder.encode('feed')),
      snapshotManifestDigest: digest(encoder.encode('snapshot')),
      matcherVersion: '0.1.0',
      comparatorRulesetDigest: digest(encoder.encode('ruleset')),
      exclusionsDigest: null,
      findingsRoot: findingsRoot(findings),
      findingsCount: findings.length,
      ecosystems: ['npm'],
    },
  });
  return { bundleVersion: BUNDLE_VERSION, statement, manifest, findings, attestation };
}

function signedBundle(): ScanBundle {
  const unsigned = bundleWith(null);
  return {
    ...unsigned,
    attestation: {
      kind: 'plain-key',
      envelope: signPlainKey(
        encoder.encode(canonicalJson(statementToJson(unsigned.statement))),
        INTOTO_PAYLOAD_TYPE,
        key.privateKeyPem,
      ),
      publicKeyPem: key.publicKeyPem,
    },
  };
}

const render = (bundle: ScanBundle): string =>
  new TextDecoder().decode(bundleBytes(bundle, manifestToJson, findingToJson));

describe('bundleToJson', () => {
  it('carries the statement, the manifest, and the findings together', () => {
    const json = bundleToJson(bundleWith(null), manifestToJson, findingToJson);
    expect(Object.keys(json).sort((a, b) => (a < b ? -1 : 1))).toStrictEqual([
      'attestation',
      'bundleVersion',
      'findings',
      'manifest',
      'statement',
    ]);
    expect(json['attestation']).toBeNull();
  });

  it('renders a plain-key attestation with its envelope and public key', () => {
    const json = bundleToJson(signedBundle(), manifestToJson, findingToJson) as unknown as {
      attestation: { kind: string; publicKeyPem: string; envelope: JsonObject };
    };
    expect(json.attestation.kind).toBe('plain-key');
    expect(json.attestation.publicKeyPem).toBe(key.publicKeyPem);
    expect(json.attestation.envelope['payloadType']).toBe(INTOTO_PAYLOAD_TYPE);
  });

  it('renders a sigstore attestation verbatim', () => {
    const inner: JsonObject = { mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.3' };
    const json = bundleToJson(
      bundleWith({ kind: 'sigstore', bundle: inner }),
      manifestToJson,
      findingToJson,
    ) as unknown as { attestation: { kind: string; bundle: JsonObject } };
    expect(json.attestation.bundle).toStrictEqual(inner);
  });

  it('serializes to canonical bytes', () => {
    expect(render(bundleWith(null))).toBe(render(bundleWith(null)));
    expect(render(bundleWith(null)).startsWith('{"attestation":null,"bundleVersion":')).toBe(true);
  });
});

describe('readBundleParts', () => {
  it('reads back what bundleToJson wrote', () => {
    const parts = readBundleParts(render(signedBundle()), 'test');
    expect(parts.attestation?.kind).toBe('plain-key');
    expect(parts.findings).toHaveLength(1);
  });

  it('refuses a bundle version it does not write', () => {
    expect(() => readBundleParts('{"bundleVersion":"dumpscan.bundle/v0"}', 'b.json')).toThrow(
      /declares bundleVersion "dumpscan.bundle\/v0"/,
    );
  });

  it('refuses anything that is not a bundle object', () => {
    expect(() => readBundleParts('[]', 'b.json')).toThrow(/is not a JSON object/);
    expect(() => readBundleParts(`{"bundleVersion":"${BUNDLE_VERSION}"}`, 'b.json')).toThrow(
      /missing statement, manifest, or findings/,
    );
  });

  it('refuses a malformed attestation', () => {
    const base = { bundleVersion: BUNDLE_VERSION, statement: {}, manifest: {}, findings: [] };
    const withAttestation = (attestation: unknown): string =>
      JSON.stringify({ ...base, attestation });

    expect(() => readBundleParts(withAttestation('x'), 'b.json')).toThrow(
      /attestation is neither null nor an object/,
    );
    expect(() => readBundleParts(withAttestation({ kind: 'pgp' }), 'b.json')).toThrow(
      /kind "pgp" is neither sigstore nor plain-key/,
    );
    expect(() => readBundleParts(withAttestation({ kind: 'sigstore' }), 'b.json')).toThrow(
      /sigstore attestation has no bundle object/,
    );
    expect(() => readBundleParts(withAttestation({ kind: 'plain-key' }), 'b.json')).toThrow(
      /has no publicKeyPem/,
    );
    expect(() =>
      readBundleParts(withAttestation({ kind: 'plain-key', publicKeyPem: 'x' }), 'b.json'),
    ).toThrow(/has no envelope/);
  });

  it('treats a missing attestation as an unsigned bundle', () => {
    const parts = readBundleParts(
      JSON.stringify({ bundleVersion: BUNDLE_VERSION, statement: {}, manifest: {}, findings: [] }),
      'b.json',
    );
    expect(parts.attestation).toBeNull();
  });
});

describe('verifyBundleOffline', () => {
  it('passes every digest check on a bundle it just built', () => {
    const result = verifyBundleOffline(signedBundle());
    expect(result.checks.filter((check) => check.name !== 'identity').every((c) => c.passed)).toBe(
      true,
    );
    expect(result.unsigned).toBe(false);
  });

  it('reports an unsigned bundle as unsigned and still checks the digests', () => {
    const result = verifyBundleOffline(bundleWith(null));
    expect(result.unsigned).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.checks.map((check) => check.name)).toStrictEqual([
      'findings-root',
      'findings-count',
      'input-manifest',
      'lockfile-subject',
    ]);
  });

  it('fails the root and count checks when the findings do not match the claim', () => {
    const bundle = { ...bundleWith(null), findings: [] };
    const result = verifyBundleOffline(bundle);
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.detail).toMatch(/and the predicate claims/);
    expect(result.checks[1]?.detail).toMatch(/carries 0 findings, and the predicate claims 1/);
  });

  it('fails the manifest check when the manifest is swapped', () => {
    const other = buildManifest({
      format: 'test',
      lockfileDigest: manifest.lockfileDigest,
      workspaceRoot: '.',
      overApproximated: false,
      packages: [inputPackage('npm', 'other', '9.9.9')],
      unresolved: [],
    });
    const result = verifyBundleOffline({ ...bundleWith(null), manifest: other });
    expect(result.checks.find((check) => check.name === 'input-manifest')?.passed).toBe(false);
  });

  it('fails the lockfile subject check when the raw digest moves', () => {
    const bundle = bundleWith(null);
    const moved = { ...bundle.manifest, lockfileDigest: digest(encoder.encode('other')) };
    const result = verifyBundleOffline({ ...bundle, manifest: moved });
    expect(result.checks.find((check) => check.name === 'lockfile-subject')?.passed).toBe(false);
  });

  it('fails the payload binding when the signature covers a different statement', () => {
    const bundle = signedBundle();
    const other = bundleWith(null, []);
    const rebound: ScanBundle = { ...other, attestation: bundle.attestation };
    const result = verifyBundleOffline(rebound);
    expect(result.checks.find((check) => check.name === 'payload-binding')?.passed).toBe(false);
  });

  it('fails the payload binding for a payload that is not JSON', () => {
    const bundle = bundleWith(null);
    const rebound: ScanBundle = {
      ...bundle,
      attestation: {
        kind: 'plain-key',
        envelope: signPlainKey(encoder.encode('not json'), INTOTO_PAYLOAD_TYPE, key.privateKeyPem),
        publicKeyPem: key.publicKeyPem,
      },
    };
    const check = verifyBundleOffline(rebound).checks.find((c) => c.name === 'payload-binding');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toMatch(/is not JSON/);
  });

  it('fails the payload binding for the wrong payload type', () => {
    const bundle = bundleWith(null);
    const rebound: ScanBundle = {
      ...bundle,
      attestation: {
        kind: 'plain-key',
        envelope: signPlainKey(encoder.encode('{}'), 'text/plain', key.privateKeyPem),
        publicKeyPem: key.publicKeyPem,
      },
    };
    const check = verifyBundleOffline(rebound).checks.find((c) => c.name === 'payload-binding');
    expect(check?.detail).toMatch(/covers payload type text\/plain/);
  });

  it('does not check a sigstore attestation offline', () => {
    const result = verifyBundleOffline(bundleWith({ kind: 'sigstore', bundle: {} }));
    expect(result.unsigned).toBe(false);
    expect(result.checks.some((check) => check.name === 'signature')).toBe(false);
  });
});

describe('verify helpers', () => {
  it('renders one line per check, marking failures', () => {
    const lines = describeChecks(verifyBundleOffline(signedBundle()));
    expect(lines.some((line) => line.startsWith('ok   findings-root'))).toBe(true);
    expect(lines.some((line) => line.startsWith('FAIL identity'))).toBe(true);
  });

  it('recomputes the findings root and renders the contents', () => {
    const bundle = bundleWith(null);
    expect(recomputeFindingsRoot(bundle)).toBe(bundle.statement.predicate.findingsRoot);
    const rendered = renderContents(bundle);
    expect(rendered.findings).toStrictEqual([findingToJson(finding)]);
    expect(rendered.manifest).toStrictEqual(manifestToJson(manifest));
  });
});
