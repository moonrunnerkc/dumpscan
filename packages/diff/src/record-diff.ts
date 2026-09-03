import { canonicalJson, compareCodeUnits, isJsonArray, isJsonObject } from '@dumpscan/canon';
import type { JsonObject, JsonValue } from '@dumpscan/canon';

export interface FieldChange {
  /** JSON Pointer to the field that changed. */
  readonly path: string;
  /** Canonical JSON of the value before, or null when the field was added. */
  readonly before: string | null;
  /** Canonical JSON of the value after, or null when the field was removed. */
  readonly after: string | null;
}

/**
 * Diffs two canonical JSON values field by field.
 *
 * Used to show what actually changed in an advisory record between two feed
 * snapshots: a new range, a withdrawal, a severity rescore. Objects are walked
 * key by key so the answer names the field rather than saying the record moved.
 * Arrays of the same length are walked index by index, which is what an edit in
 * place looks like; arrays whose length changed are reported whole, because an
 * OSV range list has no stable identity per element and lining up a shifted
 * array against the original would invent a diff nobody made.
 *
 * @param before - The earlier value.
 * @param after - The later value.
 * @returns One entry per changed field, ordered by path.
 */
export function diffJson(before: JsonValue, after: JsonValue): FieldChange[] {
  const changes: FieldChange[] = [];
  walk(before, after, '', changes);
  return changes.sort((a, b) => compareCodeUnits(a.path, b.path));
}

function walk(before: JsonValue, after: JsonValue, path: string, changes: FieldChange[]): void {
  if (canonicalJson(before) === canonicalJson(after)) return;

  if (isJsonObject(before) && isJsonObject(after)) {
    walkObjects(before, after, path, changes);
    return;
  }
  if (isJsonArray(before) && isJsonArray(after) && before.length === after.length) {
    for (let i = 0; i < before.length; i += 1) {
      walk(before[i] as JsonValue, after[i] as JsonValue, `${path}/${i}`, changes);
    }
    return;
  }
  changes.push({ path, before: canonicalJson(before), after: canonicalJson(after) });
}

function walkObjects(
  before: JsonObject,
  after: JsonObject,
  path: string,
  changes: FieldChange[],
): void {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(compareCodeUnits);
  for (const key of keys) {
    const left = before[key];
    const right = after[key];
    const childPath = `${path}/${escapePointer(key)}`;

    if (left === undefined) {
      changes.push({ path: childPath, before: null, after: canonicalJson(right as JsonValue) });
      continue;
    }
    if (right === undefined) {
      changes.push({ path: childPath, before: canonicalJson(left), after: null });
      continue;
    }
    walk(left, right, childPath, changes);
  }
}

function escapePointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}
