import { parseJson } from '@dumpscan/canon';
import type { JsonValue } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import { advisoryEcosystems, parseAdvisory } from './advisory.js';

const MINIMAL: JsonValue = {
  schema_version: '1.6.0',
  id: 'DUMPSCAN-TEST-0001',
  modified: '2025-01-01T00:00:00Z',
};

function withAffected(affected: JsonValue): JsonValue {
  return { ...(MINIMAL as Record<string, JsonValue>), affected };
}

describe('parseAdvisory', () => {
  it('reads the fields the matcher needs and keeps the whole document', () => {
    const document = {
      schema_version: '1.6.0',
      id: 'DUMPSCAN-TEST-0002',
      modified: '2025-02-03T04:05:06Z',
      withdrawn: '2025-02-04T00:00:00Z',
      aliases: ['CVE-2025-1', 'GHSA-x', 7],
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }, { type: 'CVSS_V3' }],
      affected: [
        {
          package: { ecosystem: 'npm', name: 'widget', purl: 'pkg:npm/widget' },
          ranges: [
            {
              type: 'SEMVER',
              events: [{ introduced: '0' }, { fixed: '1.2.3' }],
            },
          ],
          versions: ['1.0.0', 2],
          severity: [{ type: 'CVSS_V4', score: 'CVSS:4.0/AV:N' }],
        },
      ],
      database_specific: { cwe_ids: ['CWE-79'] },
    };
    const advisory = parseAdvisory(document, 'test');

    expect(advisory.id).toBe('DUMPSCAN-TEST-0002');
    expect(advisory.modified).toBe('2025-02-03T04:05:06Z');
    expect(advisory.withdrawn).toBe('2025-02-04T00:00:00Z');
    expect(advisory.aliases).toStrictEqual(['CVE-2025-1', 'GHSA-x']);
    expect(advisory.severity).toStrictEqual([{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }]);
    expect(advisory.document).toBe(document);

    const affected = advisory.affected[0];
    expect(affected?.ecosystem).toBe('npm');
    expect(affected?.purl).toBe('pkg:npm/widget');
    expect(affected?.versions).toStrictEqual(['1.0.0']);
    expect(affected?.ranges[0]?.events).toStrictEqual([
      { introduced: '0', fixed: null, lastAffected: null, limit: null },
      { introduced: null, fixed: '1.2.3', lastAffected: null, limit: null },
    ]);
    expect(affected?.severity).toStrictEqual([{ type: 'CVSS_V4', score: 'CVSS:4.0/AV:N' }]);
  });

  it('defaults a missing schema_version to 1.0.0 rather than guessing', () => {
    const advisory = parseAdvisory({ id: 'X', modified: 'M' }, 'test');
    expect(advisory.schemaVersion).toBe('1.0.0');
    expect(advisory.withdrawn).toBeNull();
    expect(advisory.aliases).toStrictEqual([]);
    expect(advisory.affected).toStrictEqual([]);
  });

  it('refuses a schema major version it does not implement', () => {
    expect(() => parseAdvisory({ ...MINIMAL, schema_version: '2.0.0' }, 'rec.json')).toThrow(
      /schema major version 2, and dumpscan implements 1/,
    );
  });

  it('refuses a schema_version that is not a version number', () => {
    expect(() => parseAdvisory({ ...MINIMAL, schema_version: 'draft' }, 'rec.json')).toThrow(
      /not a version number/,
    );
  });

  it('refuses a document that is not an object', () => {
    expect(() => parseAdvisory([1, 2], 'rec.json')).toThrow(/is not a JSON object/);
  });

  it('refuses a record with no id or no modified', () => {
    expect(() => parseAdvisory({ modified: 'M' }, 'rec.json')).toThrow(/has no id/);
    expect(() => parseAdvisory({ id: 'X' }, 'rec.json')).toThrow(/has no modified/);
    expect(() => parseAdvisory({ id: '', modified: 'M' }, 'rec.json')).toThrow(/has no id/);
  });

  it('skips affected entries that cannot name a package', () => {
    const advisory = parseAdvisory(
      withAffected([
        'not an object',
        { package: 'not an object' },
        { package: { ecosystem: 'npm' } },
        { package: { name: 'widget' } },
        { package: { ecosystem: 'npm', name: 'widget' } },
      ]),
      'test',
    );
    expect(advisory.affected).toHaveLength(1);
    expect(advisory.affected[0]?.name).toBe('widget');
  });

  it('skips malformed ranges, events, versions, and severities', () => {
    const advisory = parseAdvisory(
      withAffected([
        {
          package: { ecosystem: 'npm', name: 'widget' },
          ranges: [
            'nope',
            {},
            { type: 'SEMVER', events: 'nope' },
            { type: 'GIT', events: ['x', {}] },
          ],
          versions: 'not a list',
          severity: 'not a list',
        },
      ]),
      'test',
    );
    const affected = advisory.affected[0];
    expect(affected?.ranges.map((range) => range.type)).toStrictEqual(['SEMVER', 'GIT']);
    expect(affected?.ranges[0]?.events).toStrictEqual([]);
    expect(affected?.ranges[1]?.events).toStrictEqual([
      { introduced: null, fixed: null, lastAffected: null, limit: null },
    ]);
    expect(affected?.versions).toStrictEqual([]);
    expect(affected?.severity).toStrictEqual([]);
  });

  it('ignores an affected list that is not a list', () => {
    expect(parseAdvisory(withAffected('nope'), 'test').affected).toStrictEqual([]);
  });

  it('reads last_affected and limit events', () => {
    const advisory = parseAdvisory(
      withAffected([
        {
          package: { ecosystem: 'npm', name: 'widget' },
          ranges: [
            {
              type: 'ECOSYSTEM',
              events: [{ introduced: '1.0' }, { last_affected: '1.4' }, { limit: '2.0' }],
            },
          ],
        },
      ]),
      'test',
    );
    const events = advisory.affected[0]?.ranges[0]?.events ?? [];
    expect(events[1]?.lastAffected).toBe('1.4');
    expect(events[2]?.limit).toBe('2.0');
  });
});

describe('advisoryEcosystems', () => {
  it('lists distinct base ecosystems in first seen order', () => {
    const advisory = parseAdvisory(
      withAffected([
        { package: { ecosystem: 'PyPI', name: 'a' } },
        { package: { ecosystem: 'npm', name: 'b' } },
        { package: { ecosystem: 'PyPI', name: 'c' } },
        { package: { ecosystem: 'Alpine:v3.16', name: 'd' } },
      ]),
      'test',
    );
    expect(advisoryEcosystems(advisory)).toStrictEqual(['PyPI', 'npm', 'Alpine']);
  });

  it('ignores an empty ecosystem string', () => {
    const advisory = parseAdvisory(
      withAffected([{ package: { ecosystem: '', name: 'a' } }]),
      'test',
    );
    expect(advisoryEcosystems(advisory)).toStrictEqual([]);
  });

  it('reads a record straight from JSON text', () => {
    const advisory = parseAdvisory(parseJson('{"id":"A","modified":"M"}'), 'inline');
    expect(advisoryEcosystems(advisory)).toStrictEqual([]);
  });
});
