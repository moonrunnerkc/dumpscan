# 0004. Layer numbers are a total order, not four buckets

Status: accepted
Date: 2026-09-03
Amends: 0001

## Context

ADR 0001 gave each package a layer number matching the four levels in the build
guide's dependency diagram, and the boundary checker rejects any dependency that
does not point at a strictly lower number. That worked until `lockfiles` needed
the ecosystem vocabulary that `osv` already owns: the ecosystem identifiers, the
per-ecosystem name normalization, and the rule that PyPI names collapse `-_.` to
a single dash.

Duplicating name normalization in two packages is exactly the failure the
determinism rules exist to prevent. Both sides of a match have to normalize
identically, and two copies of that logic drift.

## Decision

Layer numbers become a total order rather than four buckets. Packages that the
guide draws on one line get distinct numbers in the order they may depend on each
other:

```
0   canon, merkle
10  osv
11  versions
12  lockfiles
20  predicate
21  match
30  sign
31  explain
32  diff
40  cli
41  action
```

`osv` owns the ecosystem vocabulary. `versions` maps an ecosystem to its
comparator. `lockfiles` normalizes names and builds purls using the same
functions the snapshot index was built with.

The guide's grouping still holds: nothing at 1x depends on anything at 2x or
above, and the check is unchanged apart from the numbers it reads.

## Consequences

The graph stays a total order, so it stays acyclic and the checker stays a single
integer comparison. The cost is that the numbers no longer read straight off the
diagram in the build guide; `scripts/layers.json` is the authority and this file
explains why it has more rows than the diagram has lines.
