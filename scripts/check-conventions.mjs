// Repository conventions that eslint cannot express: file length cap,
// kebab-case filenames, and the em dash ban across every tracked text file.
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const LINE_CAP = 300;
const EM_DASH = String.fromCharCode(0x2014);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)*$/;
const PATHNAME_ON_FILE_URL = /import\.meta\.url\s*\)\s*\.pathname/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'reports', '.git', '.determinism']);
const TEXT_EXT = /\.(ts|mjs|js|json|md|yml|yaml|txt|toml)$/;

const failures = [];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const roots = ['packages', 'scripts', 'docs', 'fixtures', '.github'].map((d) => join(root, d));
const files = roots.flatMap((d) => walk(d));
for (const f of ['package.json', 'tsconfig.base.json', 'eslint.config.js', 'README.md']) {
  const full = join(root, f);
  try {
    statSync(full);
    files.push(full);
  } catch {
    /* not created yet */
  }
}

for (const file of files) {
  const rel = file.slice(root.length);
  const name = basename(file);

  if (file.endsWith('.ts') || file.endsWith('.mjs')) {
    if (!KEBAB.test(name)) {
      failures.push(`${rel}: filename is not kebab-case`);
    }
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n').length;
    if (lines > LINE_CAP) {
      failures.push(
        `${rel}: ${lines} lines exceeds the ${LINE_CAP} line cap; split along a natural seam`,
      );
    }
    // On Windows a file URL's pathname is /D:/a/repo, which join turns into
    // D:\\D:\\a\\repo. Every fixture read in this repository went through that
    // once already.
    const badPath = PATHNAME_ON_FILE_URL.exec(source);
    if (badPath !== null) {
      const line = source.slice(0, badPath.index).split('\n').length;
      failures.push(
        `${rel}:${line}: reads .pathname off an import.meta.url URL, which is not a path on Windows; use fileURLToPath from node:url`,
      );
    }
  }

  if (!TEXT_EXT.test(name)) continue;
  if (rel.startsWith('/fixtures/')) continue;
  const text = readFileSync(file, 'utf8');
  const idx = text.indexOf(EM_DASH);
  if (idx !== -1) {
    const line = text.slice(0, idx).split('\n').length;
    failures.push(
      `${rel}:${line}: contains an em dash; use a comma, colon, or a separate sentence`,
    );
  }
}

// matcherVersion is written into every predicate, so the constant the engine
// exports and the version npm would publish have to be the same string.
{
  const pkg = JSON.parse(readFileSync(join(root, 'packages/match/package.json'), 'utf8'));
  const engine = readFileSync(join(root, 'packages/match/src/engine.ts'), 'utf8');
  const declared = /MATCHER_VERSION = '([^']+)'/.exec(engine)?.[1];
  if (declared !== pkg.version) {
    failures.push(
      `packages/match/src/engine.ts declares MATCHER_VERSION ${declared} but packages/match/package.json is ${pkg.version}; the predicate would claim a matcher version that was never published`,
    );
  }
}

// The CLI reports its own version, so the constant and the published version
// have to be the same string.
{
  const pkg = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
  const index = readFileSync(join(root, 'packages/cli/src/index.ts'), 'utf8');
  const declared = /VERSION = '([^']+)'/.exec(index)?.[1];
  if (declared !== pkg.version) {
    failures.push(
      `packages/cli/src/index.ts declares VERSION ${declared} but packages/cli/package.json is ${pkg.version}; dumpscan --version would report a release that was never published`,
    );
  }
}

if (failures.length > 0) {
  console.error('Convention violations:');
  for (const f of failures.sort()) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`conventions ok (${files.length} files)`);
