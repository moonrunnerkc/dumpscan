# 0011. Attribution order, and what diff can prove about comparators

Status: accepted
Date: 2026-09-03

## Context

The build guide requires that every changed finding end with exactly one cause
or be flagged `unexplained`, and lists the four causes and the evidence each
should carry. It does not say what happens when two digests moved at once, and
one of the evidence forms it asks for is not obtainable from two bundles alone.

## Decision

**Order.** Causes are tested most specific first: a package that appeared or
disappeared from the manifest is the input; a finding that started or stopped
being excluded is the exclusions file; an advisory whose record digest moved is
the feed; anything else that changed while the comparator ruleset moved is the
comparator. A change none of them explains is `unexplained`, which is a bug in
dumpscan rather than a fact about the two scans, and exits 3.

Two digests moving at once is normal, not ambiguous: a PR that upgrades a
package and adds an exclusion produces some changes the input explains and some
the exclusions file explains, and each change gets the one that actually applies
to it.

**Comparator evidence.** The guide asks `diff` to "re-run the specific version
comparison under both rulesets and show the flipped result". One dumpscan binary
holds one ruleset. Rather than pretend, the evidence names the version and both
matched ranges and says which comparison to re-run under which two versions. The
alternative, carrying whole corpora inside every bundle, would make the evidence
obtainable at the cost of a much larger bundle for a case that is rare.

**Feed evidence.** `--snapshot-a` and `--snapshot-b` are optional. Without them
the evidence is the two record digests and the two `modified` values, which both
bundles already carry, and that is enough to say the record moved and when. With
them the evidence adds a field level diff of the record itself: a new range, a
withdrawal, a rescore, each at its own JSON Pointer.

## Consequences

`diff` works on two bundles alone, which is the case a CI check has, and gets
better when the snapshots are around, which is the case an investigation has.
The one thing it cannot do without two installed dumpscans is show both sides of
a flipped comparison, and it says so in the evidence rather than leaving the
reader to wonder.
