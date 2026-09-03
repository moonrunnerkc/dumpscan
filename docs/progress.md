# Build progress

One line per completed phase: date, commit, gate result.

| Phase                                  | Date       | Commit  | Gate                                                                                                                                                     |
| -------------------------------------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 scaffold                             | 2026-09-03 | 07005ae | typecheck, lint, test, determinism, build green; CI workflow present                                                                                     |
| 1 canon and merkle                     | 2026-09-03 | 3d20fab | 91 tests green; canon and merkle at 100 percent coverage, zero dependencies; JCS fuzz green                                                              |
| 2 osv snapshot                         | 2026-09-03 | 8ada6b2 | 162 tests green; fixture snapshot reproduces sha256:77f3f140 in two directories                                                                          |
| 3 lockfiles and versions               | 2026-09-03 | 97f7f38 | 344 tests green; 13 lockfile goldens; versions mutation score 96.52 percent                                                                              |
| 4 match                                | 2026-09-03 | 5202d90 | 423 tests green; replay fixture reproduces sha256:fe78864f and sha256:c92de6e4; match mutation score 97.44 percent                                       |
| 5 predicate, sign, verify, prove       | 2026-09-03 | fa0a834 | 550 tests green; end to end signs, verifies offline, and proves inclusion; keyless exercised in CI                                                       |
| 6 Cargo, Go, Maven, exclusions, replay | 2026-09-03 | cb788cc | 687 tests green; both replay bundles reproduce their roots; match 93.78 percent and versions 93.83 percent mutation score                                |
| 7 diff and the GitHub Action           | 2026-09-03 | ccf1f3a | 731 tests green; every attribution cause covered by a constructed bundle pair; action exercised in CI                                                    |
| 8 snapshot publishing and explain      | 2026-09-03 | a23d223 | 747 tests green; publish, fetch by digest from a store, and scan with an empty cache all covered end to end                                              |
| 9 release                              | 2026-09-03 | 4b64165 | 752 tests green; coverage 94.87 percent overall with every floor held; match 93.78 percent and versions 93.83 percent mutation score; workspace at 1.0.0 |

## Correction

The phase 6 commit `3ff9f54` says `comparatorRulesetDigest` moved to
`sha256:bb9a363d`. That was true when the message was written and wrong by the
end of the phase: the Go corpus gained the bare-spelling equal pairs later in the
same phase, and the committed value is
`sha256:c3baa72998b01ca1bc7d646b902055d83298b0e14b04696ed403ec3415a06e1d`. The
history is not rewritten; this line is the correction.

## Decisions recorded

| ADR                                         | Decision                                                      |
| ------------------------------------------- | ------------------------------------------------------------- |
| 0001 workspace layout and publication       | What each package is, and which ones ship on their own        |
| 0002 deterministic fuzz corpora             | Fuzz corpora are seeded, not random                           |
| 0003 snapshot leaf encoding and layout      | What a feed Merkle leaf is, and where a record lives on disk  |
| 0004 layer numbering                        | Layer numbers are a total order, not four buckets             |
| 0005 workspace manifests                    | What a workspace lockfile produces                            |
| 0006 vitest pinned for mutation testing     | vitest is pinned to 3.2.7 so Stryker can activate mutants     |
| 0007 findings tree and matching semantics   | Findings tree shape and the edges of matching                 |
| 0008 scan bundle format                     | What a dumpscan bundle is                                     |
| 0009 comparator corpora without a toolchain | How corpora are generated with no Rust, Go, or Java installed |
| 0010 Go and OSV version spelling            | Go SEMVER ranges use the Go comparator                        |
| 0011 diff attribution order                 | Attribution order, and what diff can prove about comparators  |
| 0012 snapshot archive format                | Published snapshots are a gzipped tar, not a zip              |
| 0013 consistency proofs are unused          | Why no command emits one, and what would change that          |

## Not implemented as the guide specifies

**Consistency proofs are not wired into `prove` or `verify`.** The guide says
both depend on them. `merkle` produces and verifies them against the RFC 6962
vectors, but neither the feed tree nor the findings tree is append-only, so there
is no pair of trees a consistency proof would be sound between. ADR 0013.

**The published snapshot workflow has not run yet.** `.github/workflows/snapshot.yml`
builds a snapshot from the real OSV archives daily, signs it, serves the release
directory on localhost, and verifies the published bytes fetch and verify from a
clean cache before uploading. Every step is covered by tests against a local
store, and the download path against a fixture server, but the workflow itself
has never executed. Its cron is `17 5 * * *`, so the first real run against OSV
happens on its own schedule.

**v1.0.0 is published to npm.** Resolved: every package declares a `repository`
field and the release workflow published all eleven with provenance. See the
Release section below.

**The launch post uses this repository's fixtures, not a public project.** The
guide asks for cross-scanner divergence reproduced on a public project's
lockfiles. Neither Grype nor Trivy is installed here and no public lockfile was
available, so `docs/launch.md` walks the synthetic fixtures instead, labels them
as fixtures, and lists the public run as the work still to do before publishing.
Every command output in it and in the README was captured from a real run.

**Snapshot storage is a directory, and the published archive is gzipped tar.**
The guide offers "a directory (or a single zstd archive)". The directory is the
snapshot; the archive is only how one travels. zstd was not used because gzip is
in Node's standard library and the archive's determinism comes from the tar
headers rather than the compressor. ADR 0012.

## First run on real CI

The cross-OS matrix had never executed before 2026-09-03, because the
repository did not exist. Every phase gate above was run locally on Linux. The
first real run found three bugs, all one confusion between a filesystem path
and a URL, each hidden behind the one before it:

| Symptom                                                              | Cause                                                               | Fix                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------ |
| `lint` threw `ENOENT` on `D:\D:\a\dumpscan\scripts\layers.json`      | `new URL('..', import.meta.url).pathname` is `/D:/a/...` on Windows | `fileURLToPath`, 29 call sites |
| three resolver tests failed on a correct error message               | a `RegExp` built from a cache path, where `\U` and `\r` are escapes | assert the literal string      |
| `test:determinism`, the drift checks, and the corpus emit all failed | `import(join(root, ...))`, where ESM reads `D:` as a URL scheme     | `pathToFileURL`, 11 call sites |

`check-conventions.mjs` now rejects all three forms. Each guard was verified by
reintroducing the bad code and watching the check fail.

`byte identity across runners` passed for the first time on b3340d3. It is
gated on all three suite legs, so it had never once run. The determinism
guarantee is now demonstrated across Linux, macOS, and Windows rather than
asserted.

## Release

v1.0.0 published to npm on 2026-09-03 from tag `v1.0.0` at 375d456, all eleven
packages with SLSA provenance from the release workflow.

The tag was first cut at d8b5b3c and moved to 375d456 once CI was green on every
runner. Nothing had been published under the old tag, so it had no consumers.

Four publish attempts failed before that with `404 Not Found - PUT
@dumpscan%2fcanon`. The cause was not npm: `gh secret set --body` takes a
literal value and reads stdin only when `--body` is omitted, so `--body -`
stored the single character `-` as `NPM_TOKEN`. Every attempt was an anonymous
PUT, and npm answers an unauthenticated request for a scoped package that does
not exist with a 404 rather than a 401, which hid it. Two tokens were
regenerated chasing a permissions theory that a failed org membership write
appeared to support; that action is on npm's restricted list for granular
tokens regardless of permissions, so it was never evidence.

What found it was printing `npm whoami` before publishing, which came out empty.
The release workflow now does that on every run and fails when the registry does
not recognise the credential, rather than reporting an empty identity as
success. The publish loop also skips versions already on the registry, so a run
that dies partway can be re-run instead of failing on the first package.

`keyless signing and verification` failed once on 509e3eb and passed on the
commit before and after with no change to the signing path, so it is treated as
a transient Sigstore outage. It reported only "Sigstore signing failed" because
the CLI dropped `error.cause`; causes now print, so a repeat will say why.
