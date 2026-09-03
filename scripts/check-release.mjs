// Checks that the workspace is in a publishable state for a tagged release.
// Run with a tag: node scripts/check-release.mjs v1.0.0
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const layers = JSON.parse(readFileSync(join(root, 'scripts/layers.json'), 'utf8'));
const failures = [];

const tag = process.argv[2];
if (tag !== undefined && !/^v\d+\.\d+\.\d+$/.test(tag)) {
  failures.push(`the tag ${tag} is not vMAJOR.MINOR.PATCH; tag the release as v1.0.0, not ${tag}`);
}
const tagVersion = tag === undefined ? undefined : tag.slice(1);

let expected;
for (const dir of Object.keys(layers)) {
  const path = join(root, 'packages', dir, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  expected ??= pkg.version;

  if (pkg.version !== expected) {
    failures.push(
      `packages/${dir} is at ${pkg.version} and packages/${Object.keys(layers)[0]} is at ${expected}; the workspace publishes as one version, so set every package.json to the same string`,
    );
  }
  if (tagVersion !== undefined && pkg.version !== tagVersion) {
    failures.push(
      `packages/${dir} is at ${pkg.version} but the tag says ${tagVersion}; bump the package.json versions in a commit before tagging`,
    );
  }
  if (pkg.private === true) continue;

  if (pkg.repository === undefined) {
    failures.push(
      `packages/${dir}/package.json has no repository field; npm provenance needs one that matches the repository building the release, so add "repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git", "directory": "packages/${dir}" }`,
    );
  }
  if (pkg.publishConfig?.provenance !== true) {
    failures.push(
      `packages/${dir}/package.json does not set publishConfig.provenance; every published package carries provenance, so add "publishConfig": { "access": "public", "provenance": true }`,
    );
  }
  if (pkg.license !== 'Apache-2.0') {
    failures.push(
      `packages/${dir}/package.json declares ${pkg.license}; the repository is Apache-2.0`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(`release check ok (${Object.keys(layers).length} packages at ${expected})`);
