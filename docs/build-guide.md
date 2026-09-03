# dumpscan build guide

A vulnerability scanner whose every result is a reproducible, signed claim.

## Purpose

Given a lockfile and a pinned snapshot of the OSV vulnerability feed, dumpscan produces findings plus an attestation that binds those findings to the exact bytes of the input, the exact bytes of the feed, the exact matcher version, and the exact exclusions applied. Anyone holding that attestation can re-run the scan later and get byte-identical findings, or get a structured proof of which of the four inputs changed.

No scanner does this today. Grype and Trivy disagree on the same image by 66 to 80 percent. OSV records are withdrawn, re-scored, and re-aliased after publication. A scan report pins nothing but a wall-clock timestamp, so "the scan was clean on Tuesday" is unfalsifiable by Friday.

## Non-goals

Not a container image scanner. Not an SBOM generator. Not a policy engine. Not a UI. No reachability, exploitability, or risk scoring. Does not wrap Grype or Trivy except inside the divergence-explanation mode. Lockfiles only in v1; CycloneDX and SPDX input comes later because those formats introduce identifier ambiguity (CPE guessing, missing purls) that is the root cause of cross-tool chaos, and the first release must be unarguably reproducible.

## The three artifacts

Everything dumpscan emits or consumes is content-addressed by SHA-256 over a canonical byte form. Digests are always written as `sha256:<lowercase hex>`.

### Feed snapshot

A point-in-time capture of OSV advisories for a fixed set of ecosystems. Each advisory record is canonicalized, hashed, and the sorted set of record hashes is Merkle-rooted per RFC 6962. The snapshot carries a manifest listing: ecosystems included, record count per ecosystem, source URLs with the HTTP ETag or Last-Modified values observed at download, the per-ecosystem Merkle roots, and one top-level root over the ecosystem roots. That top-level root is the feed digest.

Storage is a directory (or a single zstd archive) of canonical record files named by hash, plus the manifest. Two snapshots with the same feed digest are interchangeable regardless of who produced them or when. Snapshots are immutable once written; a rebuild that produces a different root is a new snapshot.

### Input manifest

The parsed lockfile reduced to a canonical, deduplicated, sorted list of tuples: ecosystem, package name, exact version, purl. The raw lockfile's SHA-256 and detected format are recorded alongside. The input digest is the hash of the canonical manifest, not of the raw lockfile, so cosmetic lockfile changes (whitespace, JSON key order) don't alter the claim while the raw hash still provides traceability.

### Scan predicate

An in-toto Statement v1.

Subject: the input manifest by digest, and the raw lockfile by digest.

Predicate type: `https://dumpscan.dev/scan/v1` (versioned; bump on any body schema change).

Predicate body:

- `feedDigest`: top-level Merkle root of the snapshot
- `snapshotManifestDigest`: hash of the snapshot manifest
- `matcherVersion`: semver of the `match` package, not the CLI
- `comparatorRulesetDigest`: hash of the version-comparison test corpus, so a semantics change is detectable even at an unchanged code version
- `exclusionsDigest`: hash of the applied exclusions or OpenVEX file, or null
- `findingsRoot`: Merkle root over the findings
- `findingsCount`
- `ecosystems`: list consulted
- `evaluationTime`: present only when an exclusions file contains expiries (see Exclusions)

No other time-dependent field is permitted in the body. The DSSE envelope and Sigstore bundle carry signing time.

### Findings

A sorted list of records. Each identifies the matched package tuple, the advisory ID, the advisory's `modified` value as of the snapshot, the matched range (introduced, fixed, or last_affected events as canonical strings), aliases (CVE, GHSA), severity exactly as present in the record, and a status: `affected`, `excluded`, `withdrawn-suppressed`, or `unevaluated`. Each finding is hashed as a JCS-canonical object; the sorted hashes form the findings Merkle tree.

Findings are emitted as JSON and optionally SARIF for GitHub code scanning. SARIF is derived and never the source of truth.

## Canonicalization and hashing

JSON canonicalization is RFC 8785 (JCS): sorted keys, no whitespace, ES6 number serialization, UTF-16 code unit key ordering. Strings are NFC-normalized before hashing.

OSV records are canonicalized whole. Nothing is stripped, because severity re-scores land in `database_specific` and feed diffs must catch changes to any field.

Merkle construction follows RFC 6962: leaf hash is SHA-256(0x00 || canonical bytes), internal node is SHA-256(0x01 || left || right), with the standard handling for non-power-of-two leaf counts. The library must produce and verify inclusion proofs and consistency proofs; `prove` and `verify` depend on them.

## Feed pipeline

Source: OSV's public per-ecosystem dumps (the `all.zip` archives in the `osv-vulnerabilities` bucket). v1 ecosystems: npm, PyPI, crates.io, Go, Maven. The list is configurable.

`snapshot` downloads, unzips, canonicalizes every record, drops nothing, and writes the snapshot. Records with `withdrawn` set are kept and flagged; the matcher skips them by default and records a `withdrawn-suppressed` finding so that a later un-withdrawal surfaces in `diff`. The snapshot records the schema version declared by each record and refuses to build on an unknown schema major version.

Snapshot build must be deterministic given the same source bytes: identical input archives produce identical feed digests on any machine.

## Input parsing

One parser per lockfile format. Each is a pure function from bytes to canonical manifest, with a golden fixture corpus.

v1 formats:

- `package-lock.json` v2 and v3
- `pnpm-lock.yaml` v6 and v9
- `yarn.lock` (Berry and classic)
- `uv.lock`
- `poetry.lock`
- `Pipfile.lock`
- `requirements.txt` only when every line is pinned with `==`; otherwise refuse with a clear message
- `Cargo.lock` v3 and v4
- `go.sum` paired with `go.mod`. `go.sum` over-approximates the build graph; the manifest records this so the finding set is understood as an upper bound.
- Maven via pre-resolved `dependency:list` output, or a Gradle lockfile

Each parser emits a purl per package using the standard purl type for the ecosystem. Workspace and monorepo lockfiles produce one manifest per resolved package set, keyed by workspace root path.

## Matching engine

For each input tuple, look up advisories in the snapshot index keyed by (ecosystem, normalized name). Name normalization per ecosystem: PyPI names lowercased with runs of `-_.` collapsed to `-`; npm scoped names preserved; Go module paths case-folded per module proxy escaping rules; Maven `groupId:artifactId`.

For each `affected` entry, evaluate the version:

- `SEMVER` ranges: strict semver comparator
- `ECOSYSTEM` ranges: the ecosystem's own comparator (PEP 440 for PyPI, Cargo semver for crates.io, Go module version ordering including pseudo-versions, Maven ComparableVersion)
- explicit `versions` lists: exact string match after normalization
- `GIT` ranges: ignored in v1, recorded as `unevaluated`

Comparators are the highest-risk determinism surface. Each ships with a corpus of ordered version pairs taken from the ecosystem's reference implementation. The hash of that corpus is `comparatorRulesetDigest`.

The matcher never consults the network, the clock, environment variables, or locale.

## Exclusions and VEX

A repo may carry `dumpscan.exclusions.json` or an OpenVEX document declaring advisory IDs as not affected, with a justification string and optional expiry. The file is canonicalized and hashed; its digest is `exclusionsDigest`. Excluded findings remain in the findings set with status `excluded`, never dropped, so the findings root stays complete and "someone added an exclusion" is a first-class cause in `diff`.

Expired exclusions are treated as absent. Because expiry comparison needs a time, the time used is recorded as `evaluationTime` in the predicate body, and is the only permitted time-dependent input. It is present only when the exclusions file contains at least one expiry.

## Predicate, signing, log

The predicate is wrapped in a DSSE envelope and signed with Sigstore. In GitHub Actions this is keyless via the workflow OIDC token. Locally it falls back to the interactive Fulcio flow, or to a plain key when the user opts in explicitly. Signing produces a Sigstore bundle containing certificate, signature, and Rekor v2 inclusion proof. The bundle is the shippable evidence and is written next to the findings.

`verify` checks the bundle offline against the Sigstore trust root (TUF), checks certificate identity against an expected issuer and subject pattern, checks Rekor inclusion, then checks that the findings file on disk hashes to `findingsRoot`. Verification never re-scans.

## Command surface

`dumpscan snapshot [--ecosystems ...] [--from <mirror>] [--out <dir>]`
Builds a feed snapshot from OSV or from a local mirror. Prints the feed digest.

`dumpscan scan <lockfile> --snapshot <digest|path> [--exclusions <file>] [--sign] [--sarif <out>]`
Requires a snapshot by digest or path. No implicit "latest"; reproducibility is the default. Emits findings, predicate, and optionally the signed bundle.

`dumpscan replay <bundle> [--lockfile <path>]`
Resolves the referenced snapshot by digest (local cache, then configured snapshot stores). Re-parses the input from the provided lockfile or the manifest embedded in the bundle. Re-runs matching with the matcher pinned; refuses if the installed comparator ruleset digest differs, unless `--explain` is passed. Asserts the findings root matches. Nonzero exit with a structured report otherwise.

`dumpscan verify <bundle> [--identity <pattern>] [--issuer <url>]`
Signature, identity, log inclusion, and findings-root checks.

`dumpscan diff <bundle-a> <bundle-b>`
Attribution report (see below).

`dumpscan explain <bundle> <grype-or-trivy-json>`
Maps an external scanner's findings onto dumpscan's and classifies each discrepancy.

`dumpscan prove <bundle> <advisory-id>`
Emits a Merkle inclusion proof that a finding is or is not in the findings set, and that the advisory is in the feed snapshot.

All commands support `--json` for machine-readable output. Exit codes: 0 success, 1 findings present (scan) or mismatch (replay/verify), 2 usage error, 3 unexplained divergence (diff).

## Diff attribution

Given two predicates, `diff` compares the four input digests first.

- Input digests differ: diff the manifests; attribute each added or removed finding to a package version change.
- Feed digests differ: fetch both snapshots; for each changed finding, locate the advisory in both and show the canonical JSON diff of the record (new range, withdrawal, severity change).
- Comparator ruleset digests differ: re-run the specific version comparison under both rulesets and show the flipped result.
- Exclusions digests differ: show the exclusion added, removed, or expired.

Every changed finding ends with exactly one cause, or is flagged `unexplained`. An unexplained divergence is a bug in dumpscan and is a hard failure in CI (exit 3). Output is JSON with a human rendering.

## Divergence explanation

`explain` ingests Grype or Trivy JSON, normalizes their package identifiers to purls, aligns to dumpscan's manifest, and buckets every disagreement:

- identifier mismatch (they matched on CPE or a different name normalization)
- feed difference (advisory present in their database but not in the pinned OSV snapshot, or vice versa, checked by alias)
- range interpretation (same advisory, same package, different version comparison outcome)
- suppression (their built-in ignore rules)

This is a diagnostic. Its output is never signed.

## Published snapshot service

Replay only works if the verifier can obtain the exact feed. A scheduled GitHub Actions workflow builds a snapshot daily, signs the snapshot manifest as its own in-toto attestation (subject: the manifest; predicate: source URLs, observed ETags, record counts), and publishes the archive to a GitHub Release or an R2/S3 bucket under a path derived from the feed digest. An index file maps date to digest.

The CLI resolves a digest against a configurable ordered list of snapshot stores, verifying the snapshot attestation before trusting the bytes. Anyone can run the same workflow against their own bucket. Two independent producers hitting OSV at the same instant should produce the same digest, which is itself a checkable claim.

## GitHub Action

A composite action wraps `scan` with keyless signing, uploads the bundle as a workflow artifact, posts findings as SARIF to code scanning, and optionally runs `diff` against the bundle from the base branch's last successful run. The check fails on any unexplained divergence, or on any new `affected` finding not covered by an exclusion.

The action pins its snapshot digest by default to the latest published daily and records which one it used, so PR-to-PR comparisons have a stable feed unless the repo opts into daily rolling.

## Repository layout

pnpm workspace. Node 22 baseline. ESM, named exports only, kebab-case filenames, 300-line file cap. TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No native modules; zstd via a WASM build if archives are compressed.

Packages under `packages/`:

- `canon`: JCS, NFC normalization, digest formatting. Zero dependencies.
- `merkle`: RFC 6962 tree, inclusion proofs, consistency proofs. Zero dependencies.
- `osv`: schema types, snapshot build, index.
- `lockfiles`: one module per format behind a common parser interface.
- `versions`: one comparator per ecosystem plus the corpus that produces the ruleset digest.
- `match`: the engine. Pure functions only.
- `predicate`: in-toto statement construction and validation against a published JSON Schema.
- `sign`: sigstore-js wrapper, bundle IO, verification.
- `diff`: attribution.
- `explain`: external scanner alignment.
- `cli`: command surface.
- `action`: GitHub composite action.

`canon` and `merkle` are published separately for reuse.

## Determinism guarantee and testing

The README states: same input digest, same feed digest, same comparator ruleset digest, same exclusions digest implies a byte-identical findings file, on any OS, any Node 22+, any locale, any timezone.

Enforcement:

- CI matrix on ubuntu, macos, windows runs the full fixture corpus and diffs findings bytes across runners; any difference fails.
- Property tests for comparators: antisymmetry, transitivity, agreement with the reference-implementation corpus.
- Golden tests for every lockfile parser.
- Fuzz target for the JCS implementation against a second independent implementation.
- Replay test: scan a fixture against a stored snapshot and assert the historical findings root committed in the repo.
- Mutation testing floor on `versions` and `match`; a surviving mutant there is a silent correctness hole.
- Coverage floor 85 percent on `canon`, `merkle`, `versions`, `match`, `predicate`.
- Tests run with `TZ` and `LANG` randomized per run to catch locale leaks.

## Threat model

- A developer who wants a cleaner scan: any change to input, feed, matcher, or exclusions changes a digest in the signed predicate, and `diff` names it.
- A tampered feed mirror: the snapshot attestation is signed, and independent producers reaching the same digest is checkable.
- A compromised CI runner forging results: keyless signing binds the certificate to the workflow identity that produced the claim.
- Retroactive feed edits by OSV: not an attack, but the exact drift the snapshot pins.

Out of scope: vulnerabilities absent from OSV, and correctness of OSV data.

## Phased build

Weeks one and two: `canon`, `merkle`, `osv` snapshot build, npm and PyPI parsers and comparators, `match`, cross-OS byte-identity CI matrix green.

Week three: `predicate`, `sign`, `verify`, `prove`.

Week four: Cargo, Go, Maven parsers and comparators; exclusions and OpenVEX; `replay`.

Week five: `diff` with full attribution; GitHub Action with base-branch comparison.

Week six: published snapshot pipeline; `explain`; README; launch writeup that reproduces cross-scanner divergence on a public project's lockfiles, attributes every discrepancy, then replays the same scan a week later against a moved feed and shows `diff` naming exactly which advisories changed.

Ship v1.0.0 to npm with provenance enabled.

## References

- Manifest Cyber, scanner divergence: https://www.manifestcyber.com/blog/the-hidden-chaos-behind-vulnerability-scan-results
- OSV data: https://google.github.io/osv.dev/data/
- OSV schema: https://ossf.github.io/osv-schema/
- RFC 8785 JCS: https://www.rfc-editor.org/rfc/rfc8785
- RFC 6962: https://www.rfc-editor.org/rfc/rfc6962
- in-toto attestation: https://github.com/in-toto/attestation
- DSSE: https://github.com/secure-systems-lab/dsse
- sigstore-js: https://github.com/sigstore/sigstore-js
- OpenVEX: https://github.com/openvex/spec
- purl spec: https://github.com/package-url/purl-spec
