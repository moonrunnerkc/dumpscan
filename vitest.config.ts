import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const layers: Record<string, number> = JSON.parse(
  readFileSync(new URL('./scripts/layers.json', import.meta.url), 'utf8'),
) as Record<string, number>;

/**
 * Tests run against TypeScript source, never against dist, so coverage and
 * mutation reports point at the files a reviewer reads.
 */
const alias = Object.fromEntries(
  Object.keys(layers).map((pkg) => [`@dumpscan/${pkg}`, `${root}packages/${pkg}/src/index.ts`]),
);

const FLOOR = { statements: 85, branches: 85, functions: 85, lines: 85 };

export const config = defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'json', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        'packages/canon/src/**': FLOOR,
        'packages/merkle/src/**': FLOOR,
        'packages/versions/src/**': FLOOR,
        'packages/match/src/**': FLOOR,
        'packages/predicate/src/**': FLOOR,
      },
    },
  },
});

export default config;
