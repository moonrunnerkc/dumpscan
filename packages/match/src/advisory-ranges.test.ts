import type { JsonValue } from '@dumpscan/canon';
import { inputPackage } from '@dumpscan/lockfiles';
import type { InputPackage } from '@dumpscan/lockfiles';
import { parseAdvisory } from '@dumpscan/osv';
import type { OsvAdvisory } from '@dumpscan/osv';
import { describe, expect, it } from 'vitest';

import { matchAdvisory } from './advisory-match.js';

const npm = (version: string): InputPackage => inputPackage('npm', 'widget', version);
const pypi = (version: string): InputPackage => inputPackage('PyPI', 'sample-client', version);
const cargo = (version: string): InputPackage => inputPackage('crates.io', 'sample-crate', version);

function advisory(affected: JsonValue, extra: Record<string, JsonValue> = {}): OsvAdvisory {
  return parseAdvisory(
    { id: 'DUMPSCAN-TEST-1', modified: '2025-01-01T00:00:00Z', affected, ...extra },
    'test',
  );
}

const semverRange = (fixed: string): JsonValue => ({
  type: 'SEMVER',
  events: [{ introduced: '0' }, { fixed }],
});
describe('matchAdvisory range and version list handling', () => {
  it('records a GIT range as unevaluated and says so', () => {
    const finding = matchAdvisory(
      advisory([
        {
          package: { ecosystem: 'npm', name: 'widget' },
          ranges: [{ type: 'GIT', events: [{ introduced: '0' }, { fixed: 'abc123' }] }],
        },
      ]),
      npm('1.0.0'),
    );
    expect(finding?.status).toBe('unevaluated');
    expect(finding?.reason).toMatch(/does not evaluate GIT ranges/);
    expect(finding?.matchedRange).toBeNull();
  });

  it('records an unknown range type as unevaluated', () => {
    const finding = matchAdvisory(
      advisory([
        {
          package: { ecosystem: 'npm', name: 'widget' },
          ranges: [{ type: 'FUTURE', events: [{ introduced: '0' }] }],
        },
      ]),
      npm('1.0.0'),
    );
    expect(finding?.reason).toMatch(/does not evaluate FUTURE ranges/);
  });

  it('records an ecosystem with no comparator as unevaluated', () => {
    const finding = matchAdvisory(
      advisory([
        {
          package: { ecosystem: 'crates.io', name: 'sample-crate' },
          ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '1.0.0' }] }],
        },
      ]),
      cargo('0.5.0'),
    );
    expect(finding?.status).toBe('unevaluated');
    expect(finding?.reason).toMatch(/no version comparator for crates.io/);
  });

  it('records a version the comparator cannot read as unevaluated', () => {
    const finding = matchAdvisory(
      advisory([{ package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] }]),
      npm('1.5'),
    );
    expect(finding?.status).toBe('unevaluated');
    expect(finding?.reason).toMatch(/semver comparator cannot read "1.5"/);
  });

  it('records an unreadable bound in the advisory as unevaluated', () => {
    const finding = matchAdvisory(
      advisory([
        {
          package: { ecosystem: 'npm', name: 'widget' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: 'not-a-version' }] }],
        },
      ]),
      npm('1.5.0'),
    );
    expect(finding?.reason).toMatch(/cannot read "not-a-version"/);
  });

  it('prefers an affected range over an unevaluated one on the same advisory', () => {
    const finding = matchAdvisory(
      advisory([
        {
          package: { ecosystem: 'npm', name: 'widget' },
          ranges: [{ type: 'GIT', events: [{ introduced: '0' }] }, semverRange('2.0.0')],
        },
      ]),
      npm('1.5.0'),
    );
    expect(finding?.status).toBe('affected');
  });

  it('prefers an affected entry over an unevaluated one whichever comes first', () => {
    const gitLast = matchAdvisory(
      advisory([
        { package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] },
        {
          package: { ecosystem: 'npm', name: 'widget' },
          ranges: [{ type: 'GIT', events: [{ introduced: '0' }] }],
        },
      ]),
      npm('1.5.0'),
    );
    expect(gitLast?.status).toBe('affected');
  });

  it('ignores an entry that says nothing about this version', () => {
    const finding = matchAdvisory(
      advisory([
        { package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] },
        { package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('0.1.0')] },
      ]),
      npm('1.5.0'),
    );
    expect(finding?.status).toBe('affected');
    expect(finding?.matchedRange?.fixed).toBe('2.0.0');
  });

  it('reports the first affected entry when two of them match', () => {
    const finding = matchAdvisory(
      advisory([
        { package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('2.0.0')] },
        { package: { ecosystem: 'npm', name: 'widget' }, ranges: [semverRange('3.0.0')] },
      ]),
      npm('1.5.0'),
    );
    expect(finding?.matchedRange?.fixed).toBe('2.0.0');
  });

  it('uses the semver comparator for a SEMVER range even outside npm', () => {
    // pep440 reads 1.0 and semver does not, so a SEMVER range on a PyPI package
    // at 1.0 is undecidable rather than affected.
    const finding = matchAdvisory(
      advisory([
        { package: { ecosystem: 'PyPI', name: 'sample-client' }, ranges: [semverRange('2.0.0')] },
      ]),
      pypi('1.0'),
    );
    expect(finding?.status).toBe('unevaluated');
    expect(finding?.reason).toMatch(/semver comparator cannot read "1.0"/);
  });

  it('matches a versions list by string when the ecosystem has no comparator', () => {
    const finding = matchAdvisory(
      advisory([
        { package: { ecosystem: 'crates.io', name: 'sample-crate' }, versions: ['0.3.36'] },
      ]),
      cargo('0.3.36'),
    );
    expect(finding?.status).toBe('affected');
    expect(
      matchAdvisory(
        advisory([
          { package: { ecosystem: 'crates.io', name: 'sample-crate' }, versions: ['0.3.36'] },
        ]),
        cargo('0.3.37'),
      ),
    ).toBeNull();
  });

  it('does not use the comparator when it cannot read the installed version', () => {
    const finding = matchAdvisory(
      advisory([{ package: { ecosystem: 'npm', name: 'widget' }, versions: ['1.0.0'] }]),
      npm('1.0'),
    );
    expect(finding).toBeNull();
  });
});
