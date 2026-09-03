# 0013. Consistency proofs are built and tested but no command emits one

Status: accepted
Date: 2026-09-03

## Context

The build guide says the Merkle library "must produce and verify inclusion proofs
and consistency proofs; `prove` and `verify` depend on them." `merkle` implements
both against the RFC 6962 reference vectors. The inclusion proof is wired into
`prove`, which emits one for a finding against the findings root and one for an
advisory record against the feed root. Nothing emits a consistency proof.

## Decision

Keep `consistencyProof` and `verifyConsistency` in `merkle`, exported and tested,
and do not wire either into a command in v1.

A consistency proof answers one question: is tree B an append-only extension of
tree A. It is sound only when the log it covers is append-only, which is what
makes it useful for Rekor and for Certificate Transparency.

Neither tree dumpscan builds is append-only.

The feed tree is a set of the current OSV records. A day later, records have been
added, but records have also been rewritten, rescored, withdrawn, and
un-withdrawn, and each of those changes a record's hash and so replaces a leaf.
An OSV record can also disappear. A consistency proof between two feed roots
would fail on almost every real pair of snapshots, and a proof that fails when
nothing is wrong tells a verifier nothing.

The findings tree is a set of findings for one scan. Two scans are two sets, not
a log and its extension. `diff` is the tool that relates them, and it does so by
attributing each changed finding to one of the four pinned digests, which is a
stronger answer than "these two trees are consistent" would be.

## Consequences

`prove` covers inclusion, and absence by emitting every leaf so a verifier can
recompute the root and look, which is what a set with no ordering allows.

The consistency implementation stays because it costs nothing to keep, it is
covered by the CT reference vectors, and the moment dumpscan keeps an append-only
log of its own, a transparency log of published feed digests being the obvious
one, the proof it needs is already there and already tested.

Anyone reading the guide and looking for a `--consistency` flag should find this
file rather than assume the feature was forgotten.
