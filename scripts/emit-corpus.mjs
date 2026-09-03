// Emits the byte artifacts that the determinism harness and the cross-OS CI
// matrix compare: the snapshot manifest, and the findings of every fixture
// bundle scanned against it. Every artifact is canonical bytes produced the same
// way a user's scan would produce them.
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
// A dynamic import needs a URL, not a path: on Windows an absolute path starts
// with a drive letter and the ESM loader reads D: as a URL scheme.
const dist = (pkg) => pathToFileURL(join(root, `packages/${pkg}/dist/index.js`)).href;

const outDir = process.argv[2];
if (outDir === undefined) {
  console.error(
    'usage: node scripts/emit-corpus.mjs <out-dir>\nPass the directory to write corpus artifacts into.',
  );
  process.exit(2);
}

const { buildSnapshot, openSnapshot, manifestToJson: snapshotToJson } = await import(dist('osv'));
const { parseLockfile, parserFor, inputDigest, manifestToJson } = await import(dist('lockfiles'));
const { matchManifest, findingToJson } = await import(dist('match'));
const { canonicalBytes } = await import(dist('canon'));
const { rulesetDigest } = await import(dist('versions'));

const snapshotDir = mkdtempSync(join(tmpdir(), 'dumpscan-corpus-'));
const built = buildSnapshot(join(root, 'fixtures/osv/synthetic/records'), snapshotDir);
const snapshot = openSnapshot(snapshotDir);

mkdirSync(outDir, { recursive: true });
const emitted = [];

function write(name, value) {
  const path = join(outDir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, canonicalBytes(value));
  emitted.push(name);
}

write('snapshot-manifest.json', snapshotToJson(built.manifest));
write('comparator-ruleset.json', { comparatorRulesetDigest: rulesetDigest() });

const bundles = join(root, 'fixtures/bundles');
for (const bundle of readdirSync(bundles).sort()) {
  const dir = join(bundles, bundle);
  const files = readdirSync(dir)
    .sort()
    .filter((entry) => entry !== 'expected.json' && statSync(join(dir, entry)).isFile());
  const lockfiles = files.filter((entry) => parserFor(entry) !== undefined);
  const sidecars = Object.fromEntries(
    files
      .filter((entry) => !lockfiles.includes(entry))
      .map((entry) => [entry, readFileSync(join(dir, entry), 'utf8')]),
  );

  for (const filename of lockfiles) {
    const parsed = parseLockfile(filename, readFileSync(join(dir, filename)), sidecars);
    for (const manifest of parsed.manifests) {
      const result = matchManifest(manifest, snapshot);
      const slug = `${filename}--${manifest.workspaceRoot}`.replaceAll(/[^A-Za-z0-9._-]/g, '_');
      write(`${bundle}/${slug}.findings.json`, {
        feedDigest: built.feedDigest,
        inputDigest: inputDigest(manifest),
        matcherVersion: result.matcherVersion,
        findingsRoot: result.findingsRoot,
        manifest: manifestToJson(manifest),
        findings: result.findings.map(findingToJson),
      });
    }
  }
}

writeFileSync(join(outDir, 'corpus-index.txt'), `${emitted.sort().join('\n')}\n`);
console.log(`emitted ${emitted.length} artifact(s)`);
