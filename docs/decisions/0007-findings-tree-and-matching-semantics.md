# 0007. Findings tree shape and the edges of matching

Status: accepted
Date: 2026-09-03

## Context

The build guide describes findings as "a sorted list of records" and says "each
finding is hashed as a JCS-canonical object; the sorted hashes form the findings
Merkle tree". Two orderings are in play there, and several matching cases are
underspecified: what happens when only some of an advisory's ranges can be
evaluated, what an explicit `versions` list means for an ecosystem that
normalizes versions, and whether a package the parser could not resolve produces
a finding.

## Decision

**Tree shape.** Findings leaves are sorted by leaf hash, the same rule the feed's
ecosystem trees use. The findings *file* is sorted by ecosystem, name, version,
advisory id, then advisory digest, which is what a person reads. The two orders
are independent on purpose: the root does not move if the file ordering rule ever
changes, and `prove` indexes both trees the same way.

**Undecidable ranges.** A range dumpscan cannot evaluate, a `GIT` range, an
unknown range type, an ecosystem with no comparator, or a version string the
comparator refuses, produces an `unevaluated` finding that says why. It never
silently becomes "not affected". Within one advisory the strongest outcome wins:
affected beats withdrawn-suppressed beats unevaluated, so an advisory with both a
matching SEMVER range and a GIT range reports as affected.

**SEMVER outside npm.** A `SEMVER` range is evaluated with the semver comparator
whatever ecosystem it appears in, because that is what the range type declares. A
PyPI package at `1.0` against a SEMVER range is therefore `unevaluated`: semver
cannot read `1.0`, and reading it with PEP 440 would be answering a question the
record did not ask.

**Explicit version lists.** Matched with the ecosystem comparator when it can read
both strings, and by exact string equality when it cannot. On PyPI `1.0` and
`1.0.0` are the same release and a string match would miss it; on an ecosystem
with no comparator, or for a version neither side can parse, string equality is
the only honest answer.

**Unresolved packages.** A package the parser recorded as unresolved produces no
finding. It is already in the input manifest and therefore in the input digest,
so it moves that digest and `diff` attributes it to the input rather than to the
feed.

## Consequences

Every finding in the set is something the matcher decided, and everything it
could not decide is visible as such rather than absent. The cost is that a
project with git dependencies gets `unevaluated` rows it cannot act on directly;
they are the honest report of what a lockfile-only scanner can know.
