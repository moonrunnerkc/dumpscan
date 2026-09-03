// Emits the byte artifacts that the determinism harness and the cross-OS CI
// matrix compare. Every case here is a fixture scan run end to end from built
// packages, so the bytes are exactly what a user would get.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const outDir = process.argv[2];
if (outDir === undefined) {
  console.error(
    'usage: node scripts/emit-corpus.mjs <out-dir>\nPass the directory to write corpus artifacts into.',
  );
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const casesDir = join(root, 'fixtures/corpus');
let caseNames = [];
try {
  caseNames = readdirSync(casesDir).sort();
} catch {
  caseNames = [];
}

const emitted = [];
for (const name of caseNames) {
  const specPath = join(casesDir, name, 'case.json');
  let spec;
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch {
    continue;
  }
  const { runCase } = await import('./corpus-case.mjs');
  const artifacts = await runCase(root, join(casesDir, name), spec);
  for (const [file, bytes] of artifacts) {
    const target = join(outDir, name, file);
    mkdirSync(join(outDir, name), { recursive: true });
    writeFileSync(target, bytes);
    emitted.push(`${name}/${file}`);
  }
}

writeFileSync(
  join(outDir, 'corpus-index.txt'),
  emitted.sort().join('\n') + (emitted.length > 0 ? '\n' : ''),
);
console.log(`emitted ${emitted.length} artifact(s) from ${caseNames.length} case(s)`);
