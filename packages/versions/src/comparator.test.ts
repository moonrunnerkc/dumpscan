import { describe, expect, it } from 'vitest';

import {
  comparatorByName,
  comparatorFor,
  comparatorForRange,
  corpora,
  corpusDocument,
  RULESET_VERSION,
  rulesetDigest,
} from './comparator.js';
import type { Comparator } from './comparator.js';

function sign(value: number): number {
  return value === 0 ? 0 : value < 0 ? -1 : 1;
}

describe('comparatorFor', () => {
  it('maps every v1 ecosystem to its own comparator', () => {
    expect(comparatorFor('npm')?.name).toBe('semver');
    expect(comparatorFor('PyPI')?.name).toBe('pep440');
    expect(comparatorFor('crates.io')?.name).toBe('cargo');
    expect(comparatorFor('Go')?.name).toBe('go');
    expect(comparatorFor('Maven')?.name).toBe('maven');
  });

  it('gives every corpus a comparator and every comparator a corpus', () => {
    const named = corpora().map((corpus) => corpus.comparator);
    expect([...named].sort((a, b) => (a < b ? -1 : 1))).toStrictEqual([
      'cargo',
      'go',
      'maven',
      'pep440',
      'semver',
    ]);
  });

  it('resolves a comparator by the name a corpus records', () => {
    expect(comparatorByName('semver')?.name).toBe('semver');
    expect(comparatorByName('nope')).toBeUndefined();
    for (const corpus of corpora()) {
      expect(comparatorByName(corpus.comparator)?.name).toBe(corpus.comparator);
    }
  });

  it('picks the comparator a range type calls for', () => {
    expect(comparatorForRange('npm', 'SEMVER')?.name).toBe('semver');
    expect(comparatorForRange('PyPI', 'SEMVER')?.name).toBe('semver');
    expect(comparatorForRange('PyPI', 'ECOSYSTEM')?.name).toBe('pep440');
    expect(comparatorForRange('crates.io', 'ECOSYSTEM')?.name).toBe('cargo');
    expect(comparatorForRange('Maven', 'ECOSYSTEM')?.name).toBe('maven');
  });

  it('uses the Go comparator for a Go SEMVER range, because OSV drops the v', () => {
    expect(comparatorForRange('Go', 'SEMVER')?.name).toBe('go');
    expect(comparatorForRange('Go', 'ECOSYSTEM')?.name).toBe('go');
  });

  it('answers undefined for a range type dumpscan does not evaluate', () => {
    expect(comparatorForRange('npm', 'GIT')).toBeUndefined();
    expect(comparatorForRange('npm', 'FUTURE')).toBeUndefined();
  });
});

describe('rulesetDigest', () => {
  it('is a well formed digest and is stable across calls', () => {
    expect(rulesetDigest()).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(rulesetDigest()).toBe(rulesetDigest());
  });

  it('carries every corpus verbatim, so a dropped case would move it', () => {
    const document = corpusDocument() as unknown as {
      corpora: {
        ecosystem: string;
        comparator: string;
        reference: string;
        ordered: string[];
        equal: string[][];
        invalid: string[];
      }[];
    };
    const list = corpora();
    expect(document.corpora.map((entry) => entry.ecosystem)).toStrictEqual(
      list.map((corpus) => corpus.ecosystem),
    );
    for (let i = 0; i < list.length; i += 1) {
      const corpus = list[i] as (typeof list)[number];
      const rendered = document.corpora[i] as (typeof document.corpora)[number];
      expect(rendered.comparator).toBe(corpus.comparator);
      expect(rendered.reference).toBe(corpus.reference);
      expect(rendered.ordered).toStrictEqual([...corpus.ordered]);
      expect(rendered.equal).toStrictEqual(corpus.equal.map((pair) => [...pair]));
      expect(rendered.invalid).toStrictEqual([...corpus.invalid]);
    }
  });

  it('covers the whole corpus document, version tag included', () => {
    const document = corpusDocument() as unknown as { rulesetVersion: string; corpora: unknown[] };
    expect(document.rulesetVersion).toBe(RULESET_VERSION);
    expect(document.corpora).toHaveLength(corpora().length);
  });

  it('orders corpora by ecosystem so the digest does not depend on file order', () => {
    const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    const names = corpora().map((corpus) => corpus.ecosystem);
    expect([...names].sort(byCode)).toStrictEqual(names);

    const document = corpusDocument() as unknown as { corpora: { ecosystem: string }[] };
    const rendered = document.corpora.map((entry) => entry.ecosystem);
    expect([...rendered].sort(byCode)).toStrictEqual(rendered);
    expect(rendered).toStrictEqual(names);
  });
});

describe.each(corpora().map((corpus) => [corpus.ecosystem, corpus] as const))(
  '%s corpus',
  (_ecosystem, corpus) => {
    const comparator = comparatorByName(corpus.comparator) as Comparator;

    it('has a comparator', () => {
      expect(comparator).toBeDefined();
      expect(corpus.ordered.length).toBeGreaterThan(20);
    });

    it('orders every pair the way the reference implementation did', () => {
      for (let i = 0; i < corpus.ordered.length; i += 1) {
        for (let j = 0; j < corpus.ordered.length; j += 1) {
          const a = corpus.ordered[i] as string;
          const b = corpus.ordered[j] as string;
          expect(sign(comparator.compare(a, b))).toBe(sign(i - j));
        }
      }
    });

    it('treats the recorded equivalent spellings as equal', () => {
      for (const [a, b] of corpus.equal) {
        expect(comparator.compare(a, b)).toBe(0);
        expect(comparator.compare(b, a)).toBe(0);
      }
    });

    it('refuses every string the reference implementation refuses', () => {
      for (const version of corpus.invalid) {
        expect(comparator.accepts(version)).toBe(false);
        expect(() => comparator.compare(version, corpus.ordered[0] as string)).toThrow();
        expect(() => comparator.compare(corpus.ordered[0] as string, version)).toThrow();
      }
    });

    it('accepts every string in the ordered list', () => {
      for (const version of corpus.ordered) expect(comparator.accepts(version)).toBe(true);
      for (const [a, b] of corpus.equal) {
        expect(comparator.accepts(a)).toBe(true);
        expect(comparator.accepts(b)).toBe(true);
      }
    });

    // Comparing every triple by calling the comparator would parse each version
    // once per comparison. The matrix is built once and the laws are checked
    // against it, which is the same coverage at a thousandth of the work.
    const all = [...corpus.ordered, ...corpus.equal.flat()];
    const matrix = all.map((a) => all.map((b) => sign(comparator.compare(a, b))));

    it('is antisymmetric', () => {
      for (let i = 0; i < all.length; i += 1) {
        for (let j = 0; j < all.length; j += 1) {
          expect((matrix[i]?.[j] ?? 0) + (matrix[j]?.[i] ?? 0)).toBe(0);
        }
      }
    });

    it('is reflexive', () => {
      for (let i = 0; i < all.length; i += 1) expect(matrix[i]?.[i]).toBe(0);
    });

    it('is transitive', () => {
      for (let i = 0; i < all.length; i += 1) {
        for (let j = 0; j < all.length; j += 1) {
          if ((matrix[i]?.[j] ?? 0) > 0) continue;
          for (let k = 0; k < all.length; k += 1) {
            if ((matrix[j]?.[k] ?? 0) > 0) continue;
            expect(matrix[i]?.[k]).toBeLessThanOrEqual(0);
          }
        }
      }
    });
  },
);
