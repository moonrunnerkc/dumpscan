import { parse as parseYaml } from 'yaml';

import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputPackage } from './manifest.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';
import { splitYarnDescriptor } from './spec.js';

/** Protocols that resolve to something other than a registry release. */
const NON_REGISTRY = new Set(['workspace', 'file', 'link', 'portal', 'patch', 'exec']);

/**
 * Parses `yarn.lock`, both the classic v1 format and the Berry YAML format.
 *
 * Classic yarn.lock looks like YAML and is not: `version "4.17.21"` is a field
 * line, not a mapping entry. It gets a hand written reader. Berry writes real
 * YAML with a `__metadata` block, and its `resolution` field is authoritative,
 * so the name and version come from there rather than from the descriptor.
 */
export const yarnLockParser: LockfileParser = {
  format: 'yarn.lock',
  filenames: ['yarn.lock'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  // Berry is real YAML with a __metadata block. Classic also happens to parse as
  // YAML, into a mapping of descriptor to the nonsense scalar `version "1.0.0"`,
  // so the presence of __metadata is what tells them apart rather than whether
  // the parse succeeded.
  const document = tryYaml(input.text);
  const result =
    document !== null && '__metadata' in document ? parseBerry(document) : parseClassic(input);
  return {
    format: result.format,
    manifests: [
      buildManifest({
        format: result.format,
        lockfileDigest: input.lockfileDigest,
        workspaceRoot: ROOT_WORKSPACE,
        overApproximated: false,
        packages: result.packages,
        unresolved: result.unresolved,
      }),
    ],
  };
}

interface Extracted {
  readonly format: string;
  readonly packages: InputPackage[];
  readonly unresolved: string[];
}

function tryYaml(text: string): Record<string, unknown> | null {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch {
    return null;
  }
  return typeof document === 'object' && document !== null && !Array.isArray(document)
    ? (document as Record<string, unknown>)
    : null;
}

function parseBerry(document: Record<string, unknown>): Extracted {
  const metadata =
    typeof document['__metadata'] === 'object' && document['__metadata'] !== null
      ? (document['__metadata'] as Record<string, unknown>)
      : {};
  const declared = metadata['version'];
  const format = `yarn.lock berry v${
    typeof declared === 'number' || typeof declared === 'string' ? String(declared) : 'unknown'
  }`;

  const packages: InputPackage[] = [];
  const unresolved: string[] = [];

  for (const [descriptors, value] of Object.entries(document)) {
    if (descriptors === '__metadata') continue;
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Record<string, unknown>;

    const resolution = entry['resolution'];
    const version = entry['version'];
    const parsed = typeof resolution === 'string' ? splitYarnDescriptor(resolution) : null;
    const name = parsed?.name ?? firstName(descriptors);
    if (name === null) continue;

    const protocol = parsed?.protocol ?? null;
    if (protocol !== null && NON_REGISTRY.has(protocol)) continue;
    if (typeof version !== 'string' || version === '') {
      unresolved.push(name);
      continue;
    }
    packages.push(inputPackage('npm', name, version));
  }

  return { format, packages, unresolved };
}

function parseClassic(input: ParseInput): Extracted {
  const packages: InputPackage[] = [];
  const unresolved: string[] = [];
  let descriptors: string | null = null;
  let version: string | null = null;
  let resolvedProtocol: string | null = null;

  const flush = (): void => {
    if (descriptors === null) return;
    const name = firstName(descriptors);
    const skip = resolvedProtocol !== null && NON_REGISTRY.has(resolvedProtocol);
    if (name !== null && !skip) {
      if (version === null) unresolved.push(name);
      else packages.push(inputPackage('npm', name, version));
    }
    descriptors = null;
    version = null;
    resolvedProtocol = null;
  };

  for (const raw of input.text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    if (!/^\s/.test(line)) {
      flush();
      descriptors = line.replace(/:\s*$/, '');
      continue;
    }

    const field = /^\s+(\S+)\s+"?([^"]*)"?\s*$/.exec(line);
    if (field === null) continue;
    if (field[1] === 'version') version = (field[2] ?? '').trim();
    if (field[1] === 'resolved') resolvedProtocol = protocolOf(field[2] ?? '');
  }
  flush();

  const declared = /^#\s*yarn\s+lockfile\s+v(\d+)/im.exec(input.text);
  return {
    format: `yarn.lock classic v${declared?.[1] ?? '1'}`,
    packages,
    unresolved,
  };
}

function firstName(descriptors: string): string | null {
  const first = descriptors.split(',')[0];
  if (first === undefined) return null;
  return splitYarnDescriptor(first)?.name ?? null;
}

function protocolOf(resolved: string): string | null {
  const colon = resolved.indexOf(':');
  if (colon === -1) return null;
  const protocol = resolved.slice(0, colon);
  return protocol === 'https' || protocol === 'http' ? null : protocol;
}
