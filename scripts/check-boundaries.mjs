// Enforces the downward dependency direction declared in CLAUDE.md.
// A package may only depend on packages in a strictly lower layer.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const layers = JSON.parse(readFileSync(join(root, 'scripts/layers.json'), 'utf8'));
const byPackageName = new Map(Object.keys(layers).map((d) => [`@dumpscan/${d}`, d]));
byPackageName.set('dumpscan', 'cli');

const failures = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:from|import)\s+['"]([^'"]+)['"]/g;

for (const [dir, layer] of Object.entries(layers)) {
  const pkgPath = join(root, 'packages', dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));

  for (const dep of declared) {
    const depDir = byPackageName.get(dep);
    if (depDir === undefined) continue;
    if (layers[depDir] >= layer) {
      failures.push(
        `packages/${dir} (layer ${layer}) declares ${dep} (layer ${layers[depDir]}); dependencies must point strictly downward`,
      );
    }
  }

  const srcDir = join(root, 'packages', dir, 'src');
  let files = [];
  try {
    files = walk(srcDir);
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (!spec.startsWith('@dumpscan/') && spec !== 'dumpscan') continue;
      const depDir = byPackageName.get(spec);
      if (depDir === undefined) {
        failures.push(`${file.slice(root.length)} imports unknown workspace package ${spec}`);
        continue;
      }
      if (!declared.has(spec)) {
        failures.push(
          `${file.slice(root.length)} imports ${spec} but packages/${dir}/package.json does not declare it`,
        );
      }
      if (layers[depDir] >= layer) {
        failures.push(
          `${file.slice(root.length)} imports ${spec} (layer ${layers[depDir]}) from layer ${layer}; dependencies must point strictly downward`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Dependency boundary violations:');
  for (const f of [...new Set(failures)].sort()) console.error(`  ${f}`);
  console.error(
    '\nFix by moving the shared code into a lower layer package, or by inverting the dependency with a type parameter.',
  );
  process.exit(1);
}
console.log(`boundaries ok (${Object.keys(layers).length} packages)`);
