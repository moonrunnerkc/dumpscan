import { compareCodeUnits } from '@dumpscan/canon';

export interface DependencyNode {
  /** Unique key within the lockfile, such as `lodash@4.17.21`. */
  readonly key: string;
  readonly name: string;
  readonly version: string;
  /** Keys of the packages this one pulls in. */
  readonly dependencies: readonly string[];
}

/**
 * Walks the dependency graph from a set of roots and returns everything
 * reachable, in a deterministic order.
 *
 * Workspace aware lockfiles record which packages each member depends on but
 * not the transitive closure, so the closure has to be computed to answer "what
 * does this member actually install". Ordering is by key rather than by
 * traversal order, so the result does not depend on how the roots were listed.
 *
 * @param nodes - Every package in the lockfile, keyed the same way dependencies
 * refer to them.
 * @param roots - Keys to start from. Keys with no node are ignored.
 * @returns The reachable nodes, ordered by key.
 */
export function closureFrom(
  nodes: ReadonlyMap<string, DependencyNode>,
  roots: readonly string[],
): DependencyNode[] {
  const seen = new Set<string>();
  const pending = [...roots];

  while (pending.length > 0) {
    const key = pending.pop() as string;
    if (seen.has(key)) continue;
    const node = nodes.get(key);
    if (node === undefined) continue;
    seen.add(key);
    for (const dependency of node.dependencies) {
      if (!seen.has(dependency)) pending.push(dependency);
    }
  }

  return [...seen]
    .map((key) => nodes.get(key) as DependencyNode)
    .sort((a, b) => compareCodeUnits(a.key, b.key));
}
