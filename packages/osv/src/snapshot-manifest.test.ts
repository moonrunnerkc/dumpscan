import { canonicalBytes, digest, parseJson } from '@dumpscan/canon';
import type { Digest } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import {
  ecosystemRoot,
  feedRoot,
  manifestDigest,
  manifestToJson,
  MANIFEST_VERSION,
  parseManifest,
  sortDigests,
} from './snapshot-manifest.js';
import type { SnapshotEcosystem, SnapshotManifest, SnapshotSource } from './snapshot-manifest.js';

const encoder = new TextEncoder();
const d = (text: string): Digest => digest(encoder.encode(text));

const NPM: SnapshotEcosystem = {
  ecosystem: 'npm',
  recordCount: 2,
  root: ecosystemRoot([d('a'), d('b')]),
  source: { url: 'https://example.invalid/npm/all.zip', etag: 'W/"1"', lastModified: null },
};

const PYPI: SnapshotEcosystem = {
  ecosystem: 'PyPI',
  recordCount: 1,
  root: ecosystemRoot([d('c')]),
  source: null,
};

const MANIFEST: SnapshotManifest = {
  manifestVersion: MANIFEST_VERSION,
  feedDigest: feedRoot([NPM, PYPI]),
  recordCount: 3,
  osvSchemaVersions: ['1.6.0'],
  ecosystems: [PYPI, NPM],
};

describe('sortDigests', () => {
  it('orders by raw hash bytes', () => {
    const sorted = sortDigests([d('z'), d('a'), d('m')]);
    const hexes = sorted.map((value) => value.slice('sha256:'.length));
    expect([...hexes].sort()).toStrictEqual(hexes);
  });

  it('does not mutate its argument', () => {
    const input = [d('z'), d('a')];
    const copy = [...input];
    sortDigests(input);
    expect(input).toStrictEqual(copy);
  });
});

describe('ecosystemRoot', () => {
  it('does not depend on the order the digests arrive in', () => {
    expect(ecosystemRoot([d('a'), d('b'), d('c')])).toBe(ecosystemRoot([d('c'), d('a'), d('b')]));
  });

  it('changes when a record is added, removed, or replaced', () => {
    const base = ecosystemRoot([d('a'), d('b')]);
    expect(ecosystemRoot([d('a')])).not.toBe(base);
    expect(ecosystemRoot([d('a'), d('b'), d('c')])).not.toBe(base);
    expect(ecosystemRoot([d('a'), d('B')])).not.toBe(base);
  });

  it('roots the empty ecosystem to the empty tree', () => {
    expect(ecosystemRoot([])).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('feedRoot', () => {
  it('does not depend on the order the ecosystems arrive in', () => {
    expect(feedRoot([NPM, PYPI])).toBe(feedRoot([PYPI, NPM]));
  });

  it('binds the ecosystem name, so renaming one moves the feed digest', () => {
    expect(feedRoot([{ ...NPM, ecosystem: 'nqm' }, PYPI])).not.toBe(feedRoot([NPM, PYPI]));
  });

  it('binds the record count, so a lost record moves the feed digest', () => {
    expect(feedRoot([{ ...NPM, recordCount: 1 }, PYPI])).not.toBe(feedRoot([NPM, PYPI]));
  });

  it('ignores the recorded source, which is provenance rather than content', () => {
    expect(feedRoot([{ ...NPM, source: null }, PYPI])).toBe(feedRoot([NPM, PYPI]));
  });
});

describe('manifestToJson and manifestDigest', () => {
  it('renders sources as null when absent and as an object when present', () => {
    const json = manifestToJson(MANIFEST) as unknown as {
      ecosystems: { ecosystem: string; source: unknown }[];
    };
    expect(json.ecosystems[0]?.source).toBeNull();
    expect(json.ecosystems[1]?.source).toStrictEqual({
      url: 'https://example.invalid/npm/all.zip',
      etag: 'W/"1"',
      lastModified: null,
    });
  });

  it('hashes the canonical form, so key order in the source object is irrelevant', () => {
    expect(manifestDigest(MANIFEST)).toBe(digest(canonicalBytes(manifestToJson(MANIFEST))));
  });

  it('moves when the recorded ETag moves, because provenance is part of the manifest', () => {
    const source: SnapshotSource = {
      url: 'https://example.invalid/npm/all.zip',
      etag: 'W/"2"',
      lastModified: null,
    };
    const moved: SnapshotManifest = {
      ...MANIFEST,
      ecosystems: [PYPI, { ...NPM, source }],
    };
    expect(manifestDigest(moved)).not.toBe(manifestDigest(MANIFEST));
  });
});

describe('parseManifest', () => {
  it('round trips a manifest through its canonical JSON', () => {
    const text = new TextDecoder().decode(canonicalBytes(manifestToJson(MANIFEST)));
    const parsed = parseManifest(parseJson(text), 'manifest.json');
    expect(manifestDigest(parsed)).toBe(manifestDigest(MANIFEST));
    expect(parsed.ecosystems.map((entry) => entry.ecosystem)).toStrictEqual(['PyPI', 'npm']);
  });

  it('refuses a manifest version it does not write', () => {
    expect(() => parseManifest({ manifestVersion: 'dumpscan.snapshot/v0' }, 'm')).toThrow(
      /declares manifestVersion "dumpscan.snapshot\/v0"/,
    );
  });

  it('refuses anything that is not a manifest object', () => {
    expect(() => parseManifest([], 'm')).toThrow(/is not a JSON object/);
    expect(() => parseManifest({ manifestVersion: MANIFEST_VERSION }, 'm')).toThrow(
      /has no ecosystems array/,
    );
  });

  it('refuses malformed digests, counts, and schema version lists', () => {
    const base = { manifestVersion: MANIFEST_VERSION, ecosystems: [] };
    expect(() => parseManifest({ ...base, feedDigest: 'nope' }, 'm')).toThrow(
      /feedDigest is "nope", not a sha256: digest/,
    );
    expect(() => parseManifest({ ...base, feedDigest: d('x'), recordCount: -1 }, 'm')).toThrow(
      /recordCount is -1, not a non-negative integer/,
    );
    expect(() => parseManifest({ ...base, feedDigest: d('x'), recordCount: 1.5 }, 'm')).toThrow(
      /not a non-negative integer/,
    );
    expect(() =>
      parseManifest({ ...base, feedDigest: d('x'), recordCount: 0, osvSchemaVersions: 'x' }, 'm'),
    ).toThrow(/osvSchemaVersions is not an array of strings/);
    expect(() =>
      parseManifest({ ...base, feedDigest: d('x'), recordCount: 0, osvSchemaVersions: [1] }, 'm'),
    ).toThrow(/osvSchemaVersions\[0\] is not a string/);
  });

  it('refuses malformed ecosystem entries', () => {
    const base = {
      manifestVersion: MANIFEST_VERSION,
      feedDigest: d('x'),
      recordCount: 0,
      osvSchemaVersions: [],
    };
    expect(() => parseManifest({ ...base, ecosystems: ['x'] }, 'm')).toThrow(
      /ecosystems\[0\] is not a JSON object/,
    );
    expect(() => parseManifest({ ...base, ecosystems: [{}] }, 'm')).toThrow(
      /ecosystems\[0\] has no ecosystem name/,
    );
    expect(() =>
      parseManifest(
        { ...base, ecosystems: [{ ecosystem: 'npm', recordCount: 0, root: 'x' }] },
        'm',
      ),
    ).toThrow(/ecosystems\[0\] root is "x"/);
  });

  it('refuses a source that is neither null nor an object with a url', () => {
    const entry = { ecosystem: 'npm', recordCount: 0, root: d('r') };
    const base = {
      manifestVersion: MANIFEST_VERSION,
      feedDigest: d('x'),
      recordCount: 0,
      osvSchemaVersions: [],
    };
    expect(() => parseManifest({ ...base, ecosystems: [{ ...entry, source: 'x' }] }, 'm')).toThrow(
      /source is neither null nor an object/,
    );
    expect(() => parseManifest({ ...base, ecosystems: [{ ...entry, source: {} }] }, 'm')).toThrow(
      /source has no url/,
    );
    const parsed = parseManifest(
      { ...base, ecosystems: [{ ...entry, source: { url: 'u', etag: 1, lastModified: 2 } }] },
      'm',
    );
    expect(parsed.ecosystems[0]?.source).toStrictEqual({
      url: 'u',
      etag: null,
      lastModified: null,
    });
  });
});
