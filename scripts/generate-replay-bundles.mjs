// Writes fixtures/bundles/<case>/expected.json: the findings, the findings root,
// and the four digests a predicate would pin. Run with --check to fail when a
// bundle has drifted, which is what the replay test asserts on every run.
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const bundles = join(root, 'fixtures/bundles');
const snapshotRecords = join(root, 'fixtures/osv/synthetic/records');

const { buildSnapshot, openSnapshot } = await import(join(root, 'packages/osv/dist/index.js'));
const { parseLockfile, parserFor, inputDigest, manifestToJson } = await import(
  join(root, 'packages/lockfiles/dist/index.js')
);
const { matchManifest, findingToJson } = await import(join(root, 'packages/match/dist/index.js'));
const { rulesetDigest } = await import(join(root, 'packages/versions/dist/index.js'));

const snapshotDir = mkdtempSync(join(tmpdir(), 'dumpscan-replay-'));
const built = buildSnapshot(snapshotRecords, snapshotDir);
const snapshot = openSnapshot(snapshotDir);

// Files a parser claims are lockfiles; everything else beside them is a sidecar,
// such as the go.mod a go.sum reads to learn the main module path.
function splitDirectory(dir) {
  const files = readdirSync(dir)
    .sort()
    .filter((entry) => entry !== 'expected.json' && statSync(join(dir, entry)).isFile());
  const lockfiles = files.filter((entry) => parserFor(entry) !== undefined);
  const sidecars = Object.fromEntries(
    files
      .filter((entry) => !lockfiles.includes(entry))
      .map((entry) => [entry, readFileSync(join(dir, entry), 'utf8')]),
  );
  return { lockfiles, sidecars };
}

function render(name) {
  const dir = join(bundles, name);
  const scans = [];
  const { lockfiles, sidecars } = splitDirectory(dir);

  for (const filename of lockfiles) {
    const parsed = parseLockfile(filename, readFileSync(join(dir, filename)), sidecars);
    for (const manifest of parsed.manifests) {
      const result = matchManifest(manifest, snapshot);
      scans.push({
        lockfile: filename,
        workspaceRoot: manifest.workspaceRoot,
        inputDigest: inputDigest(manifest),
        matcherVersion: result.matcherVersion,
        findingsRoot: result.findingsRoot,
        findingsCount: result.findings.length,
        ecosystems: result.ecosystems,
        manifest: manifestToJson(manifest),
        findings: result.findings.map(findingToJson),
      });
    }
  }

  return (
    JSON.stringify(
      {
        note: 'Committed scan of the lockfiles beside this file against fixtures/osv/synthetic. A change to findingsRoot means matching semantics moved.',
        feedDigest: built.feedDigest,
        snapshotManifestDigest: built.manifestDigest,
        comparatorRulesetDigest: rulesetDigest(),
        exclusionsDigest: null,
        scans,
      },
      null,
      2,
    ) + '\n'
  );
}

const names = readdirSync(bundles).sort();
const drifted = [];
let written = 0;

for (const name of names) {
  const text = render(name);
  const path = join(bundles, name, 'expected.json');
  if (process.argv.includes('--check')) {
    let actual = '';
    try {
      actual = readFileSync(path, 'utf8');
    } catch {
      actual = '';
    }
    if (actual !== text) drifted.push(`fixtures/bundles/${name}/expected.json`);
  } else {
    writeFileSync(path, text);
    written += 1;
  }
}

if (process.argv.includes('--check')) {
  if (drifted.length > 0) {
    console.error('Replay bundles are out of date:');
    for (const path of drifted) console.error(`  ${path}`);
    console.error(
      '\nRun pnpm build && pnpm gen:bundles. A changed findingsRoot means matching semantics moved: bump matcherVersion and say what changed.',
    );
    process.exit(1);
  }
  console.log(`replay bundles current (${names.length} cases)`);
} else {
  console.log(`wrote ${written} replay bundles`);
}
