// Runs the fixture corpus twice under hostile TZ and LANG settings and
// requires the emitted bytes to be identical.
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const outRoot = join(root, '.determinism');
rmSync(outRoot, { recursive: true, force: true });

const runs = [
  { name: 'a', env: { TZ: 'UTC', LANG: 'C', LC_ALL: 'C' } },
  {
    name: 'b',
    env: { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' },
  },
];

for (const run of runs) {
  const out = join(outRoot, run.name);
  execFileSync(process.execPath, [join(root, 'scripts/emit-corpus.mjs'), out], {
    stdio: 'inherit',
    env: { ...process.env, ...run.env },
    cwd: root,
  });
}

function walk(dir, base = dir, out = new Map()) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.set(relative(base, full), readFileSync(full));
  }
  return out;
}

const a = walk(join(outRoot, 'a'));
const b = walk(join(outRoot, 'b'));
const failures = [];

for (const key of new Set([...a.keys(), ...b.keys()])) {
  const left = a.get(key);
  const right = b.get(key);
  if (left === undefined)
    failures.push(`${key}: emitted only under TZ=Pacific/Kiritimati LANG=tr_TR.UTF-8`);
  else if (right === undefined) failures.push(`${key}: emitted only under TZ=UTC LANG=C`);
  else if (!left.equals(right))
    failures.push(`${key}: ${left.length} bytes vs ${right.length} bytes differ`);
}

if (failures.length > 0) {
  console.error('Determinism failures:');
  for (const f of failures.sort()) console.error(`  ${f}`);
  console.error(
    '\nThe emitted bytes depend on the host locale or timezone. Find the leak before continuing.',
  );
  process.exit(1);
}
console.log(`determinism ok (${a.size} artifacts identical across both runs)`);
