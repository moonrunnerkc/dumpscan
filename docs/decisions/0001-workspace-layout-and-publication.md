# 0001. Workspace layout and publication scope

Status: accepted
Date: 2026-09-03

## Context

The build guide names twelve packages and says `canon` and `merkle` are published
separately for reuse. It does not say what the other packages are called on npm, or
whether they are published at all. The CLI is plain `tsc` output, not a bundle, so
whatever `dumpscan` imports at runtime has to be resolvable from the registry.

## Decision

All packages live under the `@dumpscan` scope except the CLI, which is `dumpscan`.
Every package except `action` is published. `action` is a composite GitHub Action that
shells out to the installed CLI, so it has no runtime code and stays private.

Packages are assigned a layer number in `scripts/layers.json`. A package may depend
only on packages in a strictly lower layer:

```
0  canon, merkle
1  osv, lockfiles, versions
2  predicate, match
3  sign, diff, explain
4  cli, action
```

`predicate` takes digests, counts, and ecosystem names as plain values rather than
importing finding types from `match`, which keeps both at layer 2 with no edge
between them.

## Consequences

Publishing eleven packages is more release surface than bundling the CLI into one
tarball, but it keeps `canon` and `merkle` genuinely reusable and keeps the
dependency graph the same at runtime as it is in the repository, which is what the
boundary checker verifies. `scripts/check-boundaries.mjs` reads the layer map and
fails `pnpm lint` on any upward edge, in both `package.json` and actual import
statements, so a violation cannot land by accident.
