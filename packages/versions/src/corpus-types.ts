/**
 * One ecosystem's comparator corpus. The corpus is the specification of what the
 * comparator means: `ordered` is strictly ascending, `equal` pairs compare equal,
 * and `invalid` is refused. Its canonical bytes produce the comparator ruleset
 * digest, so a semantics change is visible even at an unchanged code version.
 */
export interface VersionCorpus {
  readonly ecosystem: string;
  readonly comparator: string;
  /** The reference implementation the ordering was taken from, with its version. */
  readonly reference: string;
  readonly ordered: readonly string[];
  readonly equal: readonly (readonly [string, string])[];
  readonly invalid: readonly string[];
}
