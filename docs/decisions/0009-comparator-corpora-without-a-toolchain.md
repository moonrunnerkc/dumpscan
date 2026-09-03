# 0009. Comparator corpora for ecosystems whose toolchain is not installed

Status: accepted
Date: 2026-09-03

## Context

The build guide says each comparator "ships with a corpus of ordered version
pairs taken from the ecosystem's reference implementation". For npm that is
node-semver and for PyPI that is `packaging`, both of which run on the machine
this was built on. Rust, Go, and Java do not.

## Decision

Each corpus records in its `reference` field exactly where its ordering came
from, and none of them claims a tool that was not run.

- **crates.io**: Cargo versions are SemVer 2.0.0, and the Rust `semver` crate
  implements the same precedence rules as node-semver. The ordering is generated
  with node-semver and the field says so. The comparator is named `cargo` rather
  than reusing `semver` so that if crates.io ever diverges, the corpus is where
  it shows up.
- **Go**: `golang.org/x/mod/semver` is SemVer with the minor and patch optional
  and build metadata ignored. The ordering is generated with node-semver after
  expanding the prefix and the implied components, and the field says so.
- **Maven**: `ComparableVersion` has no equivalent anywhere, so the algorithm is
  transcribed from the maven-artifact source into Python, the corpus is generated
  from that transcription, and the TypeScript implementation is a second,
  independent transcription that has to agree with it.

The Maven corpus is also restricted to the region where the algorithm is a total
order. `ComparableVersion` is not one in general: `11.a2` parses to
`[11, alpha, [2]]` and `11b` to `[11, [b]]`, and Maven compares a qualifier above
a nested list, so `11.a2 > 11b` while `11.a2 < 11 < 11b`. A corpus that asserted
that cycle would be a specification of nothing, so the generator inserts a
candidate only when it keeps every pair in the list consistent, and the three
versions that break it are pinned by an explicit test instead.

## Consequences

The corpora are honest about their provenance, which matters because their bytes
are `comparatorRulesetDigest` and every scan is signed against it. Replacing one
with output from the real toolchain later moves that digest, which is exactly the
kind of change the digest exists to make visible: it would be a commit that says
so, not a silent improvement.
