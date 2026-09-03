// Writes schema/scan-v1.schema.json from the constant in packages/predicate so
// the published schema and the one the code validates against cannot diverge.
// Run with --check to fail when they have.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { SCAN_STATEMENT_SCHEMA } = await import(join(root, 'packages/predicate/dist/index.js'));

const target = join(root, 'schema/scan-v1.schema.json');
const text = `${JSON.stringify(SCAN_STATEMENT_SCHEMA, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let actual = '';
  try {
    actual = readFileSync(target, 'utf8');
  } catch {
    actual = '';
  }
  if (actual !== text) {
    console.error(
      'schema/scan-v1.schema.json is out of date.\nRun pnpm build && pnpm gen:schema. A changed schema is a predicate type change, so bump the predicate type too.',
    );
    process.exit(1);
  }
  console.log('published schema current');
} else {
  mkdirSync(join(root, 'schema'), { recursive: true });
  writeFileSync(target, text);
  console.log(`wrote ${target.slice(root.length)}`);
}
