# 0008. What a dumpscan bundle is

Status: accepted
Date: 2026-09-03

## Context

The build guide names a "bundle" as the argument to `replay`, `verify`, and
`diff`, and separately describes "a Sigstore bundle containing certificate,
signature, and Rekor v2 inclusion proof" as "the shippable evidence written next
to the findings". Those are not the same object. The signed statement carries
only digests, so a Sigstore bundle on its own lets a reader check a digest
without ever seeing what was hashed, and `replay` needs the input manifest that
the statement only names by digest.

## Decision

A dumpscan bundle is one JSON file with four parts:

- `statement`: the in-toto Statement v1 that was signed.
- `manifest`: the canonical input manifest, so `replay` can re-match without the
  original lockfile and `diff` can compare package sets.
- `findings`: the findings the statement's `findingsRoot` covers.
- `attestation`: the Sigstore bundle verbatim under `kind: "sigstore"`, or a bare
  DSSE envelope with its public key under `kind: "plain-key"`, or null.

The Sigstore bundle is nested unchanged, so anything that understands Sigstore
can read it out and verify it without knowing anything about dumpscan.

`verify` recomputes the findings root from the findings in the file, the input
digest from the manifest in the file, and the digest of the signed payload, then
compares all three to what the statement claims. A signature that verifies over
some other statement fails the payload binding check, because a valid signature
over the wrong document is worth nothing here.

Plain-key mode reports the identity check as failed with an explanation rather
than passing it. A plain key binds a scan to no identity, and a verifier that
printed "ok" would be claiming otherwise.

## Consequences

A bundle is self-contained: a reader with the file alone can check every digest
and read the findings. It is larger than a Sigstore bundle, because it carries
the findings and the manifest as well, which is the point.

`--sign` and `--key` are separate flags rather than modes of one flag, so a
plain-key signature is always something someone typed on purpose.
