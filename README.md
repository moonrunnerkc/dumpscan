# dumpscan

A vulnerability scanner whose every result is a reproducible, signed claim.

## The guarantee

Same input digest, same feed digest, same comparator ruleset digest, same
exclusions digest implies a byte-identical findings file, on any operating
system, any Node 22 or later, any locale, any timezone. Those four digests are
carried in a signed in-toto predicate alongside the findings root, so a scan is
not "clean on Tuesday", it is a claim anyone can re-derive on Friday. When the
answer does change, `dumpscan diff` names which of the four moved and shows the
evidence: the package that was upgraded, the advisory field that was rewritten,
the exclusion that was added, or the comparison that flipped. A change nothing
accounts for is a bug in dumpscan and exits 3.

## Install

```
npm install --global dumpscan
```

Or run it without installing:

```
npx dumpscan --help
```

Node 22.22.2 or later. No native modules.

## The commands

Every command takes `--json` for machine readable output. Exit codes are 0 for
success, 1 for findings present or a verification or replay mismatch, 2 for a
usage error or a run that could not finish, and 3 for an unexplained divergence
in `diff`.

Every example below is real output, produced against `fixtures/` in this
repository.

### snapshot

Builds a content addressed capture of the OSV feed and prints its digest.

```
$ dumpscan snapshot --from fixtures/osv/synthetic/records --out ./snapshot
feed digest   sha256:8fb337fd94e1173eaf00e4b6d472169364319e1fec474e701eb66483471dc8d2
manifest      sha256:33b98efeeb9e6221df22d99ee8b0d6d2fdf51c7482a6ccd54701c159af67053e
records       13 written, 1 skipped
  Go          2 records  sha256:37252ebf9a25617c8a484524c5a7b4dcb82fe69179795ed07223e451a6719114
  Maven       2 records  sha256:5911abfba15a74fcad8ede3e51665ff22a426ee086944afcd8d1885404856451
  PyPI        3 records  sha256:3f6fb0ba006bdc8d758701740bd98079974e1a00daa86d9f405c627976048cb6
  crates.io   2 records  sha256:00e2c12a1c22e18bdf6a6451672dc19175e8b35e703c325750c70a92973d8ecf
  npm         5 records  sha256:7a5020d7d43a7d28cad3a708adaeb161ad8491b057a1ca3de8928c7e3dd4e394
snapshot      ./snapshot
```

Without `--from` it downloads the OSV archives for `--ecosystems`. With `--from`
it never touches the network, which is what the daily publishing workflow and
every test use.

### scan

Scans a lockfile against a snapshot you pin.

```
$ dumpscan scan package-lock.json --snapshot ./snapshot --out day1.bundle.json
format        package-lock.json v3
workspace     .
input         sha256:725b0669df04cc8794f098f0a163dfe8554f9188e3b2e4073bd6b5c348fb6b69
feed          sha256:8fb337fd94e1173eaf00e4b6d472169364319e1fec474e701eb66483471dc8d2
comparators   sha256:c3baa72998b01ca1bc7d646b902055d83298b0e14b04696ed403ec3415a06e1d
matcher       0.1.0
exclusions    none
findings      5 total, 3 affected
findingsRoot  sha256:fe78864f47561ca3a8c4cd83d6a24b1991a86100d9c3a42d5e17032dfc87d924
bundle        day1.bundle.json
```

`--snapshot` takes a digest or a path and is required. There is no `--latest`,
because two runs of the same command have to make the same claim. Add `--sign`
to sign keylessly with Sigstore, and `--sarif <path>` to also write a SARIF
2.1.0 log for GitHub code scanning. SARIF is derived and never the source of
truth: the bundle is the claim.

### replay

Re-derives a bundle's findings from its pinned inputs and asserts the root.

```
$ dumpscan replay day1.bundle.json --lockfile package-lock.json --snapshot ./snapshot
replayed      day1.bundle.json
input         sha256:725b0669df04cc8794f098f0a163dfe8554f9188e3b2e4073bd6b5c348fb6b69
feed          sha256:8fb337fd94e1173eaf00e4b6d472169364319e1fec474e701eb66483471dc8d2
comparators   sha256:c3baa72998b01ca1bc7d646b902055d83298b0e14b04696ed403ec3415a06e1d
findings      5 reproduced
findingsRoot  sha256:fe78864f47561ca3a8c4cd83d6a24b1991a86100d9c3a42d5e17032dfc87d924 matches
```

On a mismatch it names which digest moved and what that means, rather than only
saying the answer changed:

```
$ dumpscan replay day1.bundle.json --snapshot ./snapshot-day2
feedDigest: recorded sha256:8fb337fd..., observed sha256:93ad3d65...; the
  snapshot supplied is not the one this bundle was scanned against
snapshotManifestDigest: recorded sha256:33b98efe..., observed sha256:01974161...;
  the manifest moved with the feed, which the feed digest already said
findingsRoot: recorded sha256:fe78864f..., observed sha256:a90b6f28...; the
  replayed findings are not the findings this bundle claims
```

A comparator ruleset that differs from the one that produced the bundle is a
hard stop unless `--explain` is passed: a matching root would be luck, and a
differing one would be unattributable.

### verify

Checks the signature, the certificate identity, log inclusion, and that the
findings in the file hash to the root the statement claims. Never re-scans.

```
$ dumpscan verify dumpscan.bundle.json
ok   findings-root: findings hash to sha256:fe78864f...
ok   findings-count: bundle carries 5 findings, and the predicate claims 5
ok   input-manifest: input manifest hashes to sha256:725b0669...
ok   lockfile-subject: raw lockfile digest sha256:781f0654... matches the subject
ok   signature: the DSSE envelope verifies under the plain key it carries
ok   payload-binding: the signature covers the statement in this bundle
FAIL identity: this bundle was signed with a plain key, which binds it to no
     identity; only a keyless signature proves who produced the scan
```

That is a real plain-key run, and the identity failure is the point: a signature
proves a scan happened, not who produced it. A keyless bundle passes that check
when the reader says which identity they expected:

```
$ dumpscan verify dumpscan.bundle.json \
    --issuer https://token.actions.githubusercontent.com \
    --identity https://github.com/you/repo/.github/workflows/ci.yml@refs/heads/main
```

### diff

Attributes every changed finding to exactly one pinned input.

```
$ dumpscan diff day1.bundle.json day2.bundle.json --snapshot-a ./snap-day1 --snapshot-b ./snap-day2
input       same   sha256:725b0669df04cc8794f098f0a163dfe8554f9188e3b2e4073bd6b5c348fb6b69
feed        moved  sha256:8fb337fd94e1173eaf... -> sha256:93ad3d65d1b3c0d7233d...
comparator  same   sha256:c3baa72998b01ca1bc7d646b902055d83298b0e14b04696ed403ec3415a06e1d
exclusions  same   none

2 findings changed
  changed feed        npm cheeseparser 4.17.20 DUMPSCAN-NPM-0001
  changed feed        npm cheeseparser 4.17.20 DUMPSCAN-NPM-0003
```

With both snapshots available, the JSON evidence names the field that moved:

```json
"recordDiff": [
  { "path": "/affected/0/ranges/0/events/1/fixed", "before": "\"4.17.21\"", "after": "\"5.0.0\"" },
  { "path": "/modified", "before": "\"2025-01-14T09:00:00Z\"", "after": "\"2026-09-02T11:00:00Z\"" },
  { "path": "/severity/0/score", "before": "\"...S:U/C:H/I:H/A:H\"", "after": "\"...S:C/C:H/I:H/A:H\"" }
]
```

### explain

Aligns Grype or Trivy output to the same manifest and buckets every
disagreement. Never signed: it is a claim about another tool, not about the code.

```
$ dumpscan explain day1.bundle.json grype.json
scanner              grype
agreed               1
identifier mismatch  1
feed difference      3
range interpretation 0
suppression          1

  feed-difference      pkg:npm/polyglot@1.9.0 CVE-2021-22222
                       grype has CVE-2021-22222 for this package and the pinned
                       OSV snapshot has no advisory under that id or any of its aliases
  identifier-mismatch  pkg:generic/node@18.0.0 CVE-2019-11111
                       grype matched node 18.0.0 on cpe-match, and that package
                       is not in the input manifest
  suppression          pkg:npm/cheeseparser@4.17.20 DUMPSCAN-NPM-0003
                       grype reports this and dumpscan reports it as
                       withdrawn-suppressed: advisory was withdrawn at 2025-02-19T08:00:00Z

this report is a diagnostic and is never signed
```

### prove

Emits the Merkle inclusion proof for a finding, and with a snapshot, for the
advisory in the feed.

```
$ dumpscan prove day2.bundle.json DUMPSCAN-NPM-0003 --snapshot ./snap-day2
finding   DUMPSCAN-NPM-0003 is leaf 4 of 5 under sha256:a90b6f28...
path      1 hashes, verified
package   pkg:npm/cheeseparser@4.17.20 (affected)
advisory  record sha256:0c432109... is leaf 1 of 5 under sha256:53b343bf...
feed      sha256:93ad3d65...
```

An advisory that is not in the findings set comes back with every leaf instead of
a path: a set of hashes has no ordering a verifier could use to bound a gap, so
absence is shown by letting them recompute the root and look.

### publish

For operating a snapshot store. Packs a snapshot into a deterministic archive
named after its feed digest, signs its manifest as its own attestation, and
updates a date to digest index.

```
$ dumpscan publish ./snapshot --out ./release --date 2026-09-03 --sign
feed digest   sha256:8fb337fd94e1173eaf00e4b6d472169364319e1fec474e701eb66483471dc8d2
archive       8fb337fd....tar.gz (2930 bytes, sha256:cb9f97e82a21da4d08322777eacfd2b99663a3ebb60ce9bddacad3d3885b81eb)
attestation   8fb337fd....att.json
index         2026-09-03 -> sha256:8fb337fd94e1173eaf00e4b6d472169364319e1fec474e701eb66483471dc8d2
out           ./release
```

## The predicate

Every scan produces an in-toto Statement v1 with predicate type
`https://dumpscan.dev/scan/v1`, validated against
[`schema/scan-v1.schema.json`](schema/scan-v1.schema.json).

The subject is the canonical input manifest and the raw lockfile, both by digest.
The body is:

| field                     | meaning                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `feedDigest`              | top level Merkle root of the snapshot                                                                 |
| `snapshotManifestDigest`  | hash of the snapshot manifest, including where it was fetched from                                    |
| `matcherVersion`          | semver of the matching engine, not of the CLI                                                         |
| `comparatorRulesetDigest` | hash of the version comparison corpora, so a semantics change shows even at an unchanged code version |
| `exclusionsDigest`        | hash of the applied exclusions or OpenVEX file, or null                                               |
| `findingsRoot`            | RFC 6962 root over the findings                                                                       |
| `findingsCount`           | how many findings that root covers                                                                    |
| `ecosystems`              | which ecosystems were consulted                                                                       |
| `evaluationTime`          | present only when an exclusions file carries an expiry, and the only time dependent field in the body |

Signing time lives in the DSSE envelope and the Sigstore bundle, never in the
body. Published snapshots carry their own attestation under
`https://dumpscan.dev/snapshot/v1`, validated against
[`schema/snapshot-v1.schema.json`](schema/snapshot-v1.schema.json).

## Threat model

**A developer who wants a cleaner scan.** Any change to the input, the feed, the
matcher, or the exclusions moves a digest inside the signed predicate, and `diff`
names which one. Excluded and withdrawn findings stay in the set with a status
rather than disappearing, so the findings root stays complete and a suppression
is a change someone can see.

**A tampered feed mirror.** A snapshot carries a signed attestation naming the
source URLs and the validators the server returned. `dumpscan` checks it before
trusting the bytes, and checks that the unpacked manifest's own feed digest is
the one that was asked for. Two independent producers reaching the same digest
is itself a checkable claim.

**A compromised CI runner forging results.** Keyless signing binds the
certificate to the workflow identity that produced the claim. `verify --identity`
and `--issuer` are how a reader says which identity they were expecting; without
them a signature proves a scan happened but not who produced it, and `verify`
says so rather than printing ok.

**Retroactive feed edits by OSV.** Not an attack, and the exact drift a snapshot
pins. A record that is rewritten, rescored, withdrawn, or un-withdrawn shows up
in `diff` as a feed cause with the changed field named.

Out of scope: vulnerabilities absent from OSV, and the correctness of OSV data.

## What dumpscan deliberately does not do

**No `--latest`.** The caller pins a snapshot digest. A scanner that picks the
newest feed for you cannot make the same claim twice.

**No reachability, exploitability, or risk scoring.** dumpscan reports what the
advisory says about the version you installed. Whether it matters in your code is
a judgment, and a judgment does not belong in a reproducible claim.

**No dropped findings.** Excluded, withdrawn, and undecidable findings stay in the
set with a status. A findings root over a filtered set would answer a different
question every time the filter changed.

**No guessing.** A range dumpscan cannot evaluate, a `GIT` range, a version
string the comparator refuses, becomes an `unevaluated` finding that says why. It
never becomes "not affected".

**No wrapping Grype or Trivy.** Their nondeterminism would become ours. `explain`
reads their output to account for disagreements; nothing else touches them.

**No container images and no SBOM generation.** Lockfiles only in v1. CycloneDX
and SPDX input introduce the identifier ambiguity that causes cross-tool chaos in
the first place, and the first release has to be unarguably reproducible.

**No unpinned requirements.** A `requirements.txt` is read only when every line
pins with `==`, and the refusal names the line.

## Packages

`@dumpscan/canon` (RFC 8785 canonicalization and digests) and `@dumpscan/merkle`
(RFC 6962 trees and proofs) have zero dependencies, are published separately, and
are useful on their own.

## Development

```
pnpm install
pnpm build
pnpm test              # the whole suite
pnpm test:determinism  # the corpus twice, under hostile TZ and LANG, byte compared
pnpm test:coverage     # floors: 100 percent on canon and merkle, 85 elsewhere
pnpm test:mutation     # floor: 90 percent on versions and match
pnpm lint              # eslint, layering, conventions, generated file drift, prettier
```

`docs/build-guide.md` is the specification. `docs/decisions/` records every place
the guide was silent and a choice had to be made. `docs/progress.md` is the build
log.

## License

Apache-2.0. See [LICENSE](LICENSE).
