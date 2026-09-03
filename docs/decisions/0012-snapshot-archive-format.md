# 0012. Published snapshots are a gzipped tar, not a zip

Status: accepted
Date: 2026-09-03

## Context

The build guide describes snapshot storage as "a directory (or a single zstd
archive)" and allows WASM "when pure JS is too slow (zstd)". A published snapshot
has to travel as one file, and its bytes should be the same whoever packs it, so
two independent producers reaching the same feed digest can also be seen to have
produced the same archive.

The obvious container was a zip, and `fflate` already ships one.

## Decision

The archive is a ustar tar, gzipped, written by `packSnapshot`.

A zip stores an MS-DOS timestamp, and every JavaScript zip writer derives it with
`Date` methods that read the local timezone. `fflate` refuses outright for any
instant that falls outside 1980 to 2099 in local time, so packing at the 1980
epoch fails west of UTC, and any instant that does not fail still writes
different bytes in Denver and in Berlin. That is a locale leak in the one place
this project cannot have one.

A tar header is a set of fields the writer fills in itself. Every one of them
here is a constant: mode 0644, uid and gid 0, mtime 0, and the entries in sorted
path order. gzip stores its own timestamp as a plain integer, set to 0. The
result is byte identical on every machine.

zstd was not chosen because it would mean a WASM build for a compression ratio
that does not change what the archive is for, and the guide allows WASM only when
pure JavaScript is too slow. gzip over a tar of canonical JSON is not.

## Consequences

`packSnapshot` refuses a path longer than the 100 bytes a ustar header holds
rather than silently switching to an extended header format that another reader
might not support. The current layout tops out around 80 characters, and the
error says to shorten the layout rather than to widen the format.
