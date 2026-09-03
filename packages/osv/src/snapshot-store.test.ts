import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Digest } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import { parseAdvisory } from './advisory.js';
import type { OsvAdvisory } from './advisory.js';
import type { Ecosystem } from './ecosystem.js';
import { buildSnapshot } from './snapshot-build.js';
import { recordPath } from './snapshot-layout.js';
import { memoryAdvisorySource, openSnapshot } from './snapshot-store.js';

const FIXTURE_RECORDS = fileURLToPath(
  new URL('../../../fixtures/osv/synthetic/records', import.meta.url),
);

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `dumpscan-${prefix}-`));
}

function builtSnapshot(prefix: string): string {
  const out = scratch(prefix);
  buildSnapshot(FIXTURE_RECORDS, out);
  return out;
}

describe('openSnapshot', () => {
  it('reads the manifest and exposes the feed digest', () => {
    const snapshot = openSnapshot(builtSnapshot('open'));
    expect(snapshot.feedDigest).toBe(snapshot.manifest.feedDigest);
    expect([...snapshot.ecosystems].sort()).toStrictEqual([
      'Go',
      'Maven',
      'PyPI',
      'crates.io',
      'npm',
    ]);
  });

  it('looks advisories up by normalized name', () => {
    const snapshot = openSnapshot(builtSnapshot('lookup'));
    const npm = snapshot.advisoriesFor('npm', 'cheeseparser');
    expect(npm.map((advisory) => advisory.id).sort()).toStrictEqual([
      'DUMPSCAN-NPM-0001',
      'DUMPSCAN-NPM-0003',
    ]);
    expect(snapshot.advisoriesFor('npm', '@sample/widget')).toHaveLength(1);
    expect(snapshot.advisoriesFor('PyPI', 'sample-client')).toHaveLength(2);
  });

  it('returns nothing for an unknown package or an ecosystem with no index', () => {
    const snapshot = openSnapshot(builtSnapshot('missing'));
    expect(snapshot.advisoriesFor('npm', 'not-a-package')).toStrictEqual([]);
    expect(snapshot.digestsFor('Maven', 'org.example:absent')).toStrictEqual([]);
  });

  it('caches records, so the same lookup returns the same object', () => {
    const snapshot = openSnapshot(builtSnapshot('cache'));
    const first = snapshot.advisoriesFor('npm', 'cheeseparser')[0];
    const second = snapshot.advisoriesFor('npm', 'cheeseparser')[0];
    expect(first).toBe(second);
  });

  it('refuses a directory with no manifest', () => {
    expect(() => openSnapshot(scratch('bare'))).toThrow(/has no manifest\.json/);
  });

  it('refuses a record whose bytes no longer hash to its name', () => {
    const root = builtSnapshot('tampered');
    const snapshot = openSnapshot(root);
    const target = snapshot.digestsFor('npm', 'gitonly')[0] as Digest;
    writeFileSync(
      join(root, ...recordPath(target).split('/')),
      '{"id":"DUMPSCAN-NPM-0004","modified":"tampered"}',
    );
    expect(() => openSnapshot(root).advisoriesFor('npm', 'gitonly')).toThrow(
      /has been modified after it was written/,
    );
  });

  it('refuses a malformed ecosystem index', () => {
    const cases: [string, string, RegExp][] = [
      ['not-object', '[]', /is not a JSON object/],
      ['no-packages', '{"ecosystem":"npm"}', /has no packages object/],
      ['bad-list', '{"ecosystem":"npm","packages":{"a":"x"}}', /to something other than a list/],
      [
        'bad-digest',
        '{"ecosystem":"npm","packages":{"a":["nope"]}}',
        /which is not a sha256: digest/,
      ],
    ];
    for (const [name, body, message] of cases) {
      const root = builtSnapshot(`index-${name}`);
      mkdirSync(join(root, 'index'), { recursive: true });
      writeFileSync(join(root, 'index', 'npm.json'), body);
      expect(() => openSnapshot(root).advisoriesFor('npm', 'a')).toThrow(message);
    }
  });
});

describe('memoryAdvisorySource', () => {
  const advisory: OsvAdvisory = parseAdvisory(
    {
      id: 'DUMPSCAN-MEM-0001',
      modified: '2025-01-01T00:00:00Z',
      affected: [{ package: { ecosystem: 'npm', name: 'widget' } }],
    },
    'memory',
  );

  it('serves advisories without touching the filesystem', () => {
    const source = memoryAdvisorySource(
      new Map<Ecosystem, ReadonlyMap<string, readonly OsvAdvisory[]>>([
        ['npm', new Map([['widget', [advisory]]])],
      ]),
    );
    expect(source.ecosystems).toStrictEqual(['npm']);
    expect(source.advisoriesFor('npm', 'widget')).toStrictEqual([advisory]);
    expect(source.advisoriesFor('npm', 'other')).toStrictEqual([]);
    expect(source.advisoriesFor('PyPI', 'widget')).toStrictEqual([]);
  });
});
