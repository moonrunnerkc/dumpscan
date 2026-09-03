// Compares corpus artifact trees produced by different machines and fails on
// any byte difference. Used by the cross-OS CI matrix.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dirs = process.argv.slice(2);
if (dirs.length < 2) {
  console.error(
    'usage: node scripts/compare-corpora.mjs <dir> <dir> [dir...]\nPass at least two corpus output directories to compare.',
  );
  process.exit(2);
}

function walk(dir, base = dir, out = new Map()) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.set(relative(base, full).split('\\').join('/'), readFileSync(full));
  }
  return out;
}

const trees = dirs.map((d) => [d, walk(d)]);
const [refDir, refTree] = trees[0];
const failures = [];

for (const [dir, tree] of trees.slice(1)) {
  for (const key of new Set([...refTree.keys(), ...tree.keys()])) {
    const a = refTree.get(key);
    const b = tree.get(key);
    if (a === undefined) failures.push(`${key}: present in ${dir}, absent from ${refDir}`);
    else if (b === undefined) failures.push(`${key}: present in ${refDir}, absent from ${dir}`);
    else if (!a.equals(b)) failures.push(`${key}: differs between ${refDir} and ${dir}`);
  }
}

if (failures.length > 0) {
  console.error('Cross-machine byte identity failed:');
  for (const f of failures.sort()) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`byte identity ok across ${trees.length} runners (${refTree.size} artifacts)`);
