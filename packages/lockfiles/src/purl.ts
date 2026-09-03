import { normalizeNfc } from '@dumpscan/canon';
import { normalizePackageName } from '@dumpscan/osv';
import type { Ecosystem } from '@dumpscan/osv';

const PURL_TYPE: Readonly<Record<Ecosystem, string>> = {
  npm: 'npm',
  PyPI: 'pypi',
  'crates.io': 'cargo',
  Go: 'golang',
  Maven: 'maven',
};

/**
 * Builds a package URL for a resolved package.
 *
 * The purl is derived, not parsed: it is built from the ecosystem, the name, and
 * the exact version, using the type and namespace rules the purl specification
 * gives for each ecosystem. npm scopes and Go module prefixes become namespaces,
 * Maven splits `groupId:artifactId`, and PyPI names use PEP 503 normalization.
 *
 * @param ecosystem - The ecosystem the package came from.
 * @param name - The package name as the lockfile spells it.
 * @param version - The exact resolved version.
 * @returns The purl in canonical percent-encoded form.
 * @throws Error when a Maven coordinate has no `groupId:artifactId` separator.
 */
export function purlFor(ecosystem: Ecosystem, name: string, version: string): string {
  const type = PURL_TYPE[ecosystem];
  const segments = purlSegments(ecosystem, normalizeNfc(name).trim());
  const path = segments.map(encodeSegment).join('/');
  return `pkg:${type}/${path}@${encodeSegment(normalizeNfc(version).trim())}`;
}

function purlSegments(ecosystem: Ecosystem, name: string): string[] {
  switch (ecosystem) {
    case 'npm':
      return splitScope(name.toLowerCase());
    case 'PyPI':
      return [normalizePackageName('PyPI', name)];
    case 'crates.io':
      return [name];
    case 'Go':
      return splitModulePath(name.toLowerCase());
    case 'Maven':
      return splitCoordinate(name);
  }
}

function splitScope(name: string): string[] {
  if (!name.startsWith('@')) return [name];
  const slash = name.indexOf('/');
  if (slash === -1) return [name];
  return [name.slice(0, slash), name.slice(slash + 1)];
}

function splitModulePath(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

function splitCoordinate(coordinate: string): string[] {
  const colon = coordinate.indexOf(':');
  if (colon === -1) {
    throw new Error(
      `purlFor: Maven coordinate ${JSON.stringify(coordinate)} has no colon; dumpscan needs groupId:artifactId to build a purl, so record the coordinate the way dependency:list prints it`,
    );
  }
  return [coordinate.slice(0, colon), coordinate.slice(colon + 1)];
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}
