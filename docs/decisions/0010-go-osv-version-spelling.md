# 0010. Go SEMVER ranges use the Go comparator

Status: accepted
Date: 2026-09-03
Amends: 0007

## Context

ADR 0007 fixed the rule that a `SEMVER` range is evaluated with the semver
comparator whatever ecosystem it appears in, because that is what the range type
declares.

Go breaks it. `go.sum` writes module versions with the `v` the module proxy
requires, `v0.22.0`. OSV writes Go advisories with that `v` stripped, `0.22.0`.
Both spell the same version. Under the 0007 rule every Go package came back
`unevaluated`, because the semver comparator reads neither `v0.22.0` nor a Go
version with an omitted patch.

## Decision

`comparatorForRange(ecosystem, rangeType)` in `versions` decides which comparator
evaluates a range. It returns the semver comparator for a `SEMVER` range in every
ecosystem except Go, where it returns the Go comparator, and the ecosystem's own
comparator for an `ECOSYSTEM` range.

The Go comparator reads both spellings and orders them identically, and the Go
corpus records `v1.2.3` and `1.2.3` as an equal pair so that stays true.

The rule from 0007 is otherwise unchanged: a PyPI package at `1.0` against a
`SEMVER` range is still `unevaluated`, because reading it with PEP 440 would be
answering a question the record did not ask. Go is different because the two
spellings are the same version rather than two different version grammars.

## Consequences

Comparator selection now lives in `versions`, where the comparators are, rather
than in the matcher. `match` asks which comparator applies and does not know why
Go is special, which is where that knowledge belongs.
