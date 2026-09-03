// Writes fixtures/lockfiles/<case>/expected.json from the current parsers.
// Run with --check to fail when a golden has drifted, which is what the golden
// test in packages/lockfiles asserts on every run.
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const cases = join(root, 'fixtures/lockfiles');

const { parseLockfile, parserFor, manifestToJson, inputDigest } = await import(
  join(root, 'packages/lockfiles/dist/index.js')
);

// A fixture directory holds one lockfile plus any sidecars a parser reads, such
// as the go.mod beside a go.sum. The parser registry decides which is which.
function splitDirectory(dir) {
  const files = readdirSync(dir)
    .sort()
    .filter((entry) => entry !== 'expected.json' && statSync(join(dir, entry)).isFile());
  const lockfile = files.find((entry) => parserFor(entry) !== undefined);
  const sidecars = Object.fromEntries(
    files
      .filter((entry) => entry !== lockfile)
      .map((entry) => [entry, readFileSync(join(dir, entry), 'utf8')]),
  );
  return { lockfile, sidecars };
}

function render(name) {
  const dir = join(cases, name);
  const { lockfile: filename, sidecars } = splitDirectory(dir);
  if (filename === undefined) return undefined;
  const bytes = readFileSync(join(dir, filename));

  try {
    const parsed = parseLockfile(filename, bytes, sidecars);
    return (
      JSON.stringify(
        {
          lockfile: filename,
          sidecars: Object.keys(sidecars),
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
