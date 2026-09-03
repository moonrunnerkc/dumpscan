import { normalizeNfc } from '@dumpscan/canon';

/** The OSV ecosystem identifiers dumpscan handles in v1, spelled as OSV spells them. */
export const ECOSYSTEMS = ['Go', 'Maven', 'PyPI', 'crates.io', 'npm'] as const;

export type Ecosystem = (typeof ECOSYSTEMS)[number];

const KNOWN = new Set<string>(ECOSYSTEMS);

/**
 * Reports whether a string is an ecosystem dumpscan can match against.
 *
 * @param value - Candidate ecosystem identifier.
 * @returns True for one of the v1 ecosystems.
 */
export function isEcosystem(value: string): value is Ecosystem {
  return KNOWN.has(value);
}

/**
 * Strips an OSV ecosystem suffix, so `Alpine:v3.16` reduces to `Alpine`. None of
 * the v1 ecosystems carry a suffix, but records for others share the feed and
 * have to be classified before they are filtered out.
 *
 * @param value - An OSV ecosystem string.
 * @returns The portion before the first colon.
 */
export function baseEcosystem(value: string): string {
  const colon = value.indexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

/**
 * Renders an ecosystem as a filename component that survives a case insensitive
 * filesystem unchanged.
 *
 * @param ecosystem - The ecosystem identifier.
 * @returns A lowercase slug.
 */
export function ecosystemSlug(ecosystem: Ecosystem): string {
  return ecosystem.toLowerCase();
}

/**
 * Normalizes a package name to the form the snapshot index is keyed by. Both
 * sides of a match run through this, so a lockfile and an advisory that name the
 * same package agree regardless of how each spelled it.
 *
 * npm lowercases and keeps the scope. PyPI follows PEP 503: lowercase with runs
 * of `-`, `_`, and `.` collapsed to a single `-`. crates.io lowercases and folds
 * `_` to `-`, matching the uniqueness rule the registry enforces. Go case folds
 * the module path, which is what the module proxy escaping rules amount to.
 * Maven keeps `groupId:artifactId` verbatim because Maven coordinates are case
 * sensitive.
 *
 * @param ecosystem - The ecosystem the name belongs to.
 * @param name - The package name as written.
 * @returns The normalized key.
 */
export function normalizePackageName(ecosystem: Ecosystem, name: string): string {
  const trimmed = normalizeNfc(name).trim();
  switch (ecosystem) {
    case 'npm':
      return trimmed.toLowerCase();
    case 'PyPI':
      return trimmed.replace(/[-_.]+/g, '-').toLowerCase();
    case 'crates.io':
      return trimmed.replaceAll('_', '-').toLowerCase();
    case 'Go':
      return trimmed.toLowerCase();
    case 'Maven':
      return trimmed;
  }
}
