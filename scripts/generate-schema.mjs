// Writes schema/scan-v1.schema.json from the constant in packages/predicate so
// the published schema and the one the code validates against cannot diverge.
// Run with --check to fail when they have.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { SCAN_STATEMENT_SCHEMA, SNAPSHOT_STATEMENT_SCHEMA } = await import(
  join(root, 'packages/predicate/dist/index.js')
);

const schemas = [
  ['schema/scan-v1.schema.json', SCAN_STATEMENT_SCHEMA],
  ['schema/snapshot-v1.schema.json', SNAPSHOT_STATEMENT_SCHEMA],
];

if (process.argv.includes('--check')) {
  const stale = [];
  for (const [name, schema] of schemas) {
    let actual = '';
    try {
      actual = readFileSync(join(root, name), 'utf8');
    } catch {
      actual = '';
    }
    if (actual !== `${JSON.stringify(schema, null, 2)}\n`) stale.push(name);
  }
  if (stale.length > 0) {
    console.error(
      `Out of date: ${stale.join(', ')}\nRun pnpm build && pnpm gen:schema. A changed schema is a predicate type change, so bump the predicate type too.`,
    );
    process.exit(1);
  }
  console.log(`published schemas current (${schemas.length})`);
} else {
  mkdirSync(join(root, 'schema'), { recursive: true });
  for (const [name, schema] of schemas) {
    writeFileSync(join(root, name), `${JSON.stringify(schema, null, 2)}\n`);
  }
  console.log(`wrote ${schemas.length} schemas`);
}
