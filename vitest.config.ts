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
const alias = {
  // Subpath exports come first so the bare-name entry does not shadow them.
  '@dumpscan/osv/download': `${root}packages/osv/src/download.ts`,
  ...Object.fromEntries(
    Object.keys(layers).map((pkg) => [`@dumpscan/${pkg}`, `${root}packages/${pkg}/src/index.ts`]),
  ),
};

const FLOOR = { statements: 85, branches: 85, functions: 85, lines: 85 };
const COMPLETE = { statements: 100, branches: 100, functions: 100, lines: 100 };

export const config = defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'json', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.fixture.ts'],
      thresholds: {
        'packages/canon/src/**': COMPLETE,
        'packages/merkle/src/**': COMPLETE,
        'packages/versions/src/**': FLOOR,
        'packages/match/src/**': FLOOR,
        'packages/predicate/src/**': FLOOR,
      },
    },
  },
});

export default config;
