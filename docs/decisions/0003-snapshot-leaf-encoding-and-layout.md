# 0003. Snapshot Merkle leaf encoding and on-disk layout

Status: accepted
Date: 2026-09-03

## Context

The build guide says each advisory record is canonicalized, hashed, and "the
sorted set of record hashes is Merkle-rooted per RFC 6962", with "one top-level
root over the ecosystem roots". It does not say what bytes go into a leaf, nor how
records are laid out on disk beyond "a directory of canonical record files named
by hash, plus the manifest".

Both choices are load-bearing. They fix the feed digest, and every published
snapshot and every replayed bundle depends on them being stable forever.

## Decision

Ecosystem tree leaves are the record digests, not the record bodies. The leaf is
`SHA-256(0x00 || <32 raw hash bytes>)`, over digests sorted by raw byte value.
A verifier proving that an advisory is in the feed therefore needs the advisory's
own hash and the audit path, and never any other record.

Top-level tree leaves are the canonical JSON of `{ecosystem, recordCount, root}`,
one per ecosystem, ordered by ecosystem name in UTF-16 code unit order. Hashing
the name and the count alongside the root means a feed digest commits to which
ecosystems were consulted and how many records each held, so a snapshot that
quietly drops an ecosystem cannot collide with one that includes it empty.

Record files live at `records/<first two hex chars>/<full hex>.json` and contain
exactly the canonical bytes, with no trailing newline, so `sha256(file)` equals the
digest the file is named after. One flat directory is unworkable at OSV's record
count on several filesystems; two hex characters give 256 shards.

Ecosystem indexes live at `index/<lowercase ecosystem>.json`, mapping normalized
package name to the sorted record digests. The index is derived data and is not
hashed into the feed digest, but it is written from canonical JSON so two builds
still produce identical bytes.

## Consequences

The feed digest is stable against index format changes and against anything the
manifest records as provenance, and moves for exactly the things it should: a
record's content, a record appearing or disappearing, an ecosystem's record count,
and the set of ecosystems. The snapshot manifest digest is separate and does move
when an ETag moves, which is what makes it useful for attributing a rebuild.

Changing any of the above is a feed digest change for every snapshot ever
published, so it needs a new manifest version, not a patch release.
