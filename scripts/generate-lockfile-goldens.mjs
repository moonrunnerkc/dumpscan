// Writes fixtures/lockfiles/<case>/expected.json from the current parsers.
// Run with --check to fail when a golden has drifted, which is what the golden
// test in packages/lockfiles asserts on every run.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const cases = join(root, 'fixtures/lockfiles');

const { parseLockfile, manifestToJson, inputDigest } = await import(
  join(root, 'packages/lockfiles/dist/index.js')
);

function lockfileIn(dir) {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'expected.json') continue;
    if (statSync(join(dir, entry)).isFile()) return entry;
  }
  return undefined;
}

function render(name) {
  const dir = join(cases, name);
  const filename = lockfileIn(dir);
  if (filename === undefined) return undefined;
  const bytes = readFileSync(join(dir, filename));

  try {
    const parsed = parseLockfile(filename, bytes);
    return (
      JSON.stringify(
        {
          lockfile: filename,
          format: parsed.format,
          manifests: parsed.manifests.map((manifest) => ({
            inputDigest: inputDigest(manifest),
            manifest: manifestToJson(manifest),
          })),
        },
        null,
        2,
      ) + '\n'
    );
  } catch (error) {
    return JSON.stringify({ lockfile: filename, refused: String(error.message) }, null, 2) + '\n';
  }
}

const names = readdirSync(cases).sort();
const drifted = [];
let written = 0;

for (const name of names) {
  const text = render(name);
  if (text === undefined) continue;
  const path = join(cases, name, 'expected.json');
  if (process.argv.includes('--check')) {
    let actual = '';
    try {
      actual = readFileSync(path, 'utf8');
    } catch {
      actual = '';
    }
    if (actual !== text) drifted.push(`fixtures/lockfiles/${name}/expected.json`);
  } else {
    writeFileSync(path, text);
    written += 1;
  }
}

if (process.argv.includes('--check')) {
  if (drifted.length > 0) {
    console.error('Lockfile goldens are out of date:');
    for (const path of drifted) console.error(`  ${path}`);
    console.error(
      '\nRun pnpm build && pnpm gen:goldens. A changed golden means a parse changed, so the commit message has to say why.',
    );
    process.exit(1);
  }
  console.log(`lockfile goldens current (${names.length} cases)`);
} else {
  console.log(`wrote ${written} lockfile goldens`);
}
