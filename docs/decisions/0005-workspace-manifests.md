# 0005. What a workspace lockfile produces

Status: accepted
Date: 2026-09-03

## Context

The build guide says "workspace and monorepo lockfiles produce one manifest per
resolved package set, keyed by workspace root path". Lockfile formats disagree
about whether such a thing exists.

pnpm records an `importers` block naming each workspace project and its direct
dependencies, plus per-package dependency edges, so a member's installed set is
computable. uv records `[manifest] members` and per-package dependency edges, so
the same is true. npm resolves the whole workspace into one hoisted tree and does
not record which member pulled in what; reconstructing it would mean
reimplementing npm's hoisting. yarn, poetry, Pipfile, and requirements have no
notion of members at all.

## Decision

Workspace root `.` always means the whole lockfile: every package it resolves,
deduplicated. Every format produces that manifest.

Formats that record per-member dependency edges also produce one manifest per
member, keyed by the member path exactly as the lockfile spells it. Today that is
pnpm and uv. A member's manifest is the transitive closure of its own
dependencies, computed by the shared walker in `closure.ts`.

pnpm's root importer is also called `.`, and it does not get its own manifest,
because `.` is already taken by the union. In practice pnpm prunes its `packages`
block to what the workspace actually installs, so the two are the same set.

A package the lockfile pins to something other than a registry release, a git
ref, a tarball URL, a local path, is recorded by name in `unresolved` rather than
dropped. There is no version for an OSV range to be evaluated against, and a
silently missing package would make the findings set quietly incomplete.

## Consequences

`scan` has a well defined default target for every format, and `--workspace` can
select a member where the format supports one. Two members that install the same
packages still get different input digests, because the workspace root is part of
the hashed manifest.

Adding per-member support for npm later is a parser change, not a format change:
the manifest shape already carries the workspace root.
