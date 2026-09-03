import { digest, toHex } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { findingLeaves, findingsRoot } from '@dumpscan/match';
import type { Finding } from '@dumpscan/match';
import { ecosystemRoot, feedRoot, MANIFEST_VERSION } from '@dumpscan/osv';
import type { SnapshotManifest } from '@dumpscan/osv';
import { describe, expect, it } from 'vitest';

import { proveAdvisory, proveFinding, verifyProof } from './prove.js';

const encoder = new TextEncoder();
const d = (text: string): Digest => digest(encoder.encode(text));

function finding(advisoryId: string, name = 'widget'): Finding {
  return {
    ecosystem: 'npm',
    name,
    version: '1.0.0',
    purl: `pkg:npm/${name}@1.0.0`,
    advisoryId,
    advisoryModified: '2025-01-01T00:00:00Z',
    advisoryDigest: d(advisoryId),
    matchedRange: null,
    aliases: [],
    severity: [],
    status: 'affected',
    reason: null,
  };
}

const findings = ['A', 'B', 'C', 'D', 'E'].map((id) => finding(`DUMPSCAN-${id}`));

describe('proveFinding', () => {
  it('proves inclusion against the findings root', () => {
    const proof = proveFinding(findings, 'DUMPSCAN-C');
    expect(proof.present).toBe(true);
    if (!proof.present) return;
    expect(proof.proof.root).toBe(findingsRoot(findings));
    expect(proof.proof.treeSize).toBe(5);
    expect(verifyProof(proof.proof)).toBe(true);
    expect(proof.finding.advisoryId).toBe('DUMPSCAN-C');
  });

  it('proves every finding in the set', () => {
    for (const entry of findings) {
      const proof = proveFinding(findings, entry.advisoryId);
      expect(proof.present).toBe(true);
      if (proof.present) expect(verifyProof(proof.proof)).toBe(true);
    }
  });

  it('reports absence with the whole leaf set instead of a path', () => {
    const proof = proveFinding(findings, 'DUMPSCAN-Z');
    expect(proof.present).toBe(false);
    if (proof.present) return;
    expect(proof.root).toBe(findingsRoot(findings));
    expect(proof.treeSize).toBe(5);
    expect(proof.leaves).toStrictEqual(findingLeaves(findings).map(toHex));
  });

  it('reports absence for an empty findings set', () => {
    const proof = proveFinding([], 'DUMPSCAN-A');
    expect(proof.present).toBe(false);
    if (proof.present) return;
    expect(proof.treeSize).toBe(0);
    expect(proof.root).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('proves a single finding set', () => {
    const single = [finding('DUMPSCAN-ONLY')];
    const proof = proveFinding(single, 'DUMPSCAN-ONLY');
    expect(proof.present).toBe(true);
    if (proof.present) expect(proof.proof.path).toStrictEqual([]);
  });
});

describe('verifyProof', () => {
  it('rejects a proof whose root has been swapped', () => {
    const proof = proveFinding(findings, 'DUMPSCAN-C');
    expect(proof.present).toBe(true);
    if (!proof.present) return;
    expect(verifyProof({ ...proof.proof, root: d('other') })).toBe(false);
  });

  it('rejects a proof replayed at the wrong index', () => {
    const proof = proveFinding(findings, 'DUMPSCAN-C');
    expect(proof.present).toBe(true);
    if (!proof.present) return;
    const wrong = (proof.proof.index + 1) % proof.proof.treeSize;
    expect(verifyProof({ ...proof.proof, index: wrong })).toBe(false);
  });
});

describe('proveAdvisory', () => {
  const digests = ['r1', 'r2', 'r3', 'r4'].map(d);
  const npmRoot = ecosystemRoot(digests);
  const pypiRoot = ecosystemRoot([d('p1')]);
  const entries = [
    { ecosystem: 'npm', recordCount: digests.length, root: npmRoot, source: null },
    { ecosystem: 'PyPI', recordCount: 1, root: pypiRoot, source: null },
  ];
  const manifest: SnapshotManifest = {
    manifestVersion: MANIFEST_VERSION,
    feedDigest: feedRoot(entries),
    recordCount: 5,
    osvSchemaVersions: ['1.6.0'],
    ecosystems: entries,
  };

  it('proves a record against its ecosystem root and reports the feed digest', () => {
    const result = proveAdvisory(manifest, 'npm', digests, d('r3'));
    expect(result.ecosystemRoot).toBe(npmRoot);
    expect(result.feedDigest).toBe(manifest.feedDigest);
    expect(result.proof.treeSize).toBe(4);
    expect(verifyProof(result.proof)).toBe(true);
  });

  it('proves every record in the ecosystem', () => {
    for (const recordDigest of digests) {
      expect(verifyProof(proveAdvisory(manifest, 'npm', digests, recordDigest).proof)).toBe(true);
    }
  });

  it('does not depend on the order the digests arrive in', () => {
    const shuffled = [...digests].reverse();
    expect(proveAdvisory(manifest, 'npm', shuffled, d('r3')).proof).toStrictEqual(
      proveAdvisory(manifest, 'npm', digests, d('r3')).proof,
    );
  });

  it('refuses an ecosystem the snapshot does not cover', () => {
    expect(() => proveAdvisory(manifest, 'Go', digests, d('r1'))).toThrow(
      /has no Go ecosystem; it covers npm, PyPI/,
    );
  });

  it('refuses a record that is not in the ecosystem', () => {
    expect(() => proveAdvisory(manifest, 'npm', digests, d('elsewhere'))).toThrow(
      /is not one of the 4 npm records in this snapshot/,
    );
  });

  it('refuses when the records no longer hash to the root the manifest claims', () => {
    const tampered: SnapshotManifest = {
      ...manifest,
      ecosystems: [
        { ...(entries[0] as (typeof entries)[number]), root: d('wrong') },
        entries[1] as (typeof entries)[number],
      ],
    };
    expect(() => proveAdvisory(tampered, 'npm', digests, d('r1'))).toThrow(
      /has been modified since it was written/,
    );
  });
});
