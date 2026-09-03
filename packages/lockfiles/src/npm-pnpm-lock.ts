import { compareCodeUnits } from '@dumpscan/canon';
import { parse as parseYaml } from 'yaml';

import { closureFrom } from './closure.js';
import type { DependencyNode } from './closure.js';
import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputManifest } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';
import { splitNameAndVersion } from './spec.js';

interface PnpmDocument {
  readonly lockfileVersion?: unknown;
  readonly importers?: unknown;
  readonly packages?: unknown;
  readonly snapshots?: unknown;
}

type Record_ = Record<string, unknown>;

/**
 * Parses `pnpm-lock.yaml` v6 and v9.
 *
 * pnpm is the one v1 format that records which packages each workspace member
 * depends on, so it produces a manifest per importer as well as the union at
 * workspace root `.`. v6 keys packages as `/name@version` and hangs dependency
 * edges off `packages`; v9 drops the leading slash and moves the edges to
 * `snapshots`. Peer suffixes such as `(react@18.2.0)` are part of the key and
 * are stripped only when reading the name and version back out.
 */
export const pnpmLockParser: LockfileParser = {
  format: 'pnpm-lock.yaml',
  filenames: ['pnpm-lock.yaml'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  const document = parseYaml(input.text) as PnpmDocument | null;
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(
      `pnpm-lock.yaml: ${input.filename} did not parse as a YAML mapping; the file is truncated or is not a pnpm lockfile`,
    );
  }

  const declared = document.lockfileVersion;
  const version =
    typeof declared === 'string' || typeof declared === 'number' ? String(declared) : '';
  const major = Number.parseInt(version, 10);
  if (!Number.isInteger(major)) {
    throw new Error(
      `pnpm-lock.yaml: ${input.filename} has no lockfileVersion; pnpm writes one on every lockfile`,
    );
  }
  if (major !== 6 && major !== 9) {
    throw new Error(
      `pnpm-lock.yaml: ${input.filename} is lockfileVersion ${version}, and dumpscan reads 6 and 9; run pnpm install with a pnpm that writes one of those, because the key format changed between them`,
    );
  }

  const format = `pnpm-lock.yaml v${version}`;
  const keyPrefix = major === 6 ? '/' : '';
  const edgeSource = major === 6 ? asRecord(document.packages) : asRecord(document.snapshots);
  const nodes = buildNodes(asRecord(document.packages), edgeSource, keyPrefix, input.filename);

  const importers = asRecord(document.importers);
  const manifests: InputManifest[] = [];
  const everythingUnresolved: string[] = [];

  for (const member of Object.keys(importers).sort(compareCodeUnits)) {
    const roots = importerRoots(asRecord(importers[member]), keyPrefix, nodes);
    everythingUnresolved.push(...roots.unresolved);
    if (member === ROOT_WORKSPACE) continue;
    const reachable = closureFrom(nodes, roots.keys);
    const packages = reachable.map((node) => inputPackage('npm', node.name, node.version));
    manifests.push(
      buildManifest({
        format,
        lockfileDigest: input.lockfileDigest,
        workspaceRoot: member,
        overApproximated: false,
        packages,
        unresolved: roots.unresolved,
      }),
    );
  }

  manifests.unshift(
    buildManifest({
      format,
      lockfileDigest: input.lockfileDigest,
      workspaceRoot: ROOT_WORKSPACE,
      overApproximated: false,
      packages: [...nodes.values()].map((node) => inputPackage('npm', node.name, node.version)),
      unresolved: everythingUnresolved,
    }),
  );

  return { format, manifests };
}

function buildNodes(
  packages: Record_,
  edges: Record_,
  keyPrefix: string,
  filename: string,
): Map<string, DependencyNode> {
  const nodes = new Map<string, DependencyNode>();
  for (const key of Object.keys(packages).sort(compareCodeUnits)) {
    const bare = stripPeerSuffix(key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key);
    const split = splitNameAndVersion(bare);
    if (split === null) {
      throw new Error(
        `pnpm-lock.yaml: ${filename} has a package key ${JSON.stringify(key)} with no name@version; the file has been edited by hand`,
      );
    }
    nodes.set(key, {
      key,
      name: split.name,
      version: split.version,
      dependencies: dependencyKeys(asRecord(edges[key]), keyPrefix),
    });
  }
  return nodes;
}

function dependencyKeys(entry: Record_, keyPrefix: string): string[] {
  const out: string[] = [];
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    for (const [name, spec] of Object.entries(asRecord(entry[field]))) {
      if (typeof spec !== 'string' || spec.startsWith('link:')) continue;
      out.push(`${keyPrefix}${name}@${spec}`);
    }
  }
  return out.sort(compareCodeUnits);
}

function importerRoots(
  importer: Record_,
  keyPrefix: string,
  nodes: ReadonlyMap<string, DependencyNode>,
): { keys: string[]; unresolved: string[] } {
  const keys: string[] = [];
  const unresolved: string[] = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const [name, spec] of Object.entries(asRecord(importer[field]))) {
      const version = typeof spec === 'string' ? spec : asRecord(spec)['version'];
      if (typeof version !== 'string' || version === '') continue;
      if (version.startsWith('link:')) continue;
      const key = `${keyPrefix}${name}@${version}`;
      // A dependency resolved from anywhere but the registry, a tarball URL or a
      // git ref, has no entry in packages and therefore no version an advisory
      // range can be evaluated against.
      if (nodes.has(key)) keys.push(key);
      else unresolved.push(name);
    }
  }
  return { keys: keys.sort(compareCodeUnits), unresolved };
}

function stripPeerSuffix(key: string): string {
  const paren = key.indexOf('(');
  return paren === -1 ? key : key.slice(0, paren);
}

function asRecord(value: unknown): Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record_)
    : {};
}
