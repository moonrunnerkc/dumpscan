import { describe, expect, it } from 'vitest';

import { normalizeNfc } from './normalize.js';

describe('normalizeNfc', () => {
  it('composes a base character and a combining mark', () => {
    expect(normalizeNfc('é')).toBe('é');
    expect(normalizeNfc('é').length).toBe(1);
  });

  it('is idempotent', () => {
    const once = normalizeNfc('Å');
    expect(normalizeNfc(once)).toBe(once);
  });

  it('folds singleton canonical equivalents', () => {
    expect(normalizeNfc('Å')).toBe('Å');
  });

  it('decomposes composition-excluded presentation forms', () => {
    expect(normalizeNfc('דּ')).toBe('דּ');
  });

  it('leaves compatibility differences alone, unlike NFKC', () => {
    expect(normalizeNfc('ﬁ')).toBe('ﬁ');
  });

  it('passes plain ASCII through untouched', () => {
    expect(normalizeNfc('lodash')).toBe('lodash');
  });
});
