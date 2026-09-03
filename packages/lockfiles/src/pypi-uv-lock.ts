import { compareCodeUnits } from '@dumpscan/canon';
import { parse as parseToml } from 'smol-toml';

import { closureFrom } from './closure.js';
import type { DependencyNode } from './closure.js';
import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputManifest, InputPackage } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';

type Record_ = Record<string, unknown>;

/** Sources that mean the package is local rather than a release from an index. */
const LOCAL_SOURCES = ['editable', 'virtual', 'directory', 'path'];

/** Sources that pin something an index never published, so no range applies. */
const UNRESOLVABLE_SOURCES = ['git', 'url'];

/**
 * Parses `uv.lock`.
 *
 * uv records the whole workspace in one file: `[manifest] members` names the
 * workspace projects, each `[[package]]` carries its own dependency edges, and
 * a member's package entry has a local source rather than a registry one. That
 * is enough to compute what each member installs, so uv produces a manifest per
 * member alongside the union at workspace root `.`.
 */
export const uvLockParser: LockfileParser = {
  format: 'uv.lock',
  filenames: ['uv.lock'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  const document = parseToml(input.text) as Record_;
  const declared = document['version'];
  if (typeof declared !== 'number') {
    throw new Error(
      `uv.lock: ${input.filename} has no numeric version field; uv writes one at the top of every lockfile`,
    );
  }
  const format = `uv.lock v${declared}`;

  const entries = Array.isArray(document['package']) ? (document['package'] as Record_[]) : [];
  const nodes = new Map<string, DependencyNode>();
  const local = new Set<string>();
  const unresolved = new Set<string>();

  for (const entry of entries) {
    const name = entry['name'];
    const version = entry['version'];
    if (typeof name !== 'string' || typeof version !== 'string') continue;
    if (hasSource(entry['source'], LOCAL_SOURCES)) local.add(name);
    if (hasSource(entry['source'], UNRESOLVABLE_SOURCES)) unresolved.add(name);
    nodes.set(name, { key: name, name, version, dependencies: dependencyNames(entry) });
  }

  const members = Array.isArray(document['manifest'])
    ? []
    : memberNames(asRecord(document['manifest']));

  const manifests: InputManifest[] = [];
  for (const member of members) {
    const node = nodes.get(member);
    if (node === undefined) continue;
    const reachable = closureFrom(nodes, node.dependencies);
    const packages = reachable
      .filter((reached) => !local.has(reached.name) && !unresolved.has(reached.name))
      .map((reached) => inputPackage('PyPI', reached.name, reached.version));
    manifests.push(
      buildManifest({
        format,
        lockfileDigest: input.lockfileDigest,
        workspaceRoot: member,
        overApproximated: false,
        packages,
        unresolved: reachable
          .filter((reached) => unresolved.has(reached.name))
          .map((reached) => reached.name),
      }),
    );
  }

  const union: InputPackage[] = [];
  for (const node of nodes.values()) {
    if (local.has(node.name) || unresolved.has(node.name)) continue;
    union.push(inputPackage('PyPI', node.name, node.version));
  }

  manifests.unshift(
    buildManifest({
      format,
      lockfileDigest: input.lockfileDigest,
      workspaceRoot: ROOT_WORKSPACE,
      overApproximated: false,
      packages: union,
      unresolved: [...unresolved].sort(compareCodeUnits),
    }),
  );

  return { format, manifests };
}

function memberNames(manifest: Record_): string[] {
  const members = manifest['members'];
  if (!Array.isArray(members)) return [];
  return members.filter((name): name is string => typeof name === 'string').sort(compareCodeUnits);
}

function dependencyNames(entry: Record_): string[] {
  const out = new Set<string>();
  collect(entry['dependencies'], out);
  for (const group of ['optional-dependencies', 'dev-dependencies'] as const) {
    for (const value of Object.values(asRecord(entry[group]))) collect(value, out);
  }
  const metadata = asRecord(entry['metadata']);
  collect(metadata['requires-dist'], out);
  for (const value of Object.values(asRecord(metadata['requires-dev']))) collect(value, out);
  return [...out].sort(compareCodeUnits);
}

function collect(value: unknown, into: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const name = asRecord(item)['name'];
    if (typeof name === 'string') into.add(name);
  }
}

function hasSource(source: unknown, kinds: readonly string[]): boolean {
  const record = asRecord(source);
  return kinds.some((key) => key in record);
}

function asRecord(value: unknown): Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record_)
    : {};
}
