# Launch post draft: the scan was clean on Tuesday

Status: draft. Every command output below is real, produced by the fixtures in
this repository. The one thing still to do before publishing is the public
project run described at the end, which needs Grype and Trivy installed and a
real lockfile; the shape of the post does not change, only the names in it.

---

Two scanners run against the same image disagree about 66 to 80 percent of what
they find. That number is bad enough on its own. What makes it worse is that
neither of them can tell you why, because neither one wrote down what it was
looking at.

A scan report pins a wall clock timestamp and nothing else. The advisory database
it consulted has no version. The version comparison it used has no version. The
suppressions applied to it are wherever the config file happened to be that
morning. So "the scan was clean on Tuesday" is a sentence that cannot be checked
on Friday, by anyone, including the person who ran it.

dumpscan is a vulnerability scanner built the other way round. Every result is a
claim that pins four digests, and anyone holding the claim can re-derive it.

## What a claim looks like

```
$ dumpscan scan package-lock.json --snapshot sha256:8fb337fd... --sign
format        package-lock.json v3
workspace     .
input         sha256:725b0669df04cc8794f098f0a163dfe8554f9188e3b2e4073bd6b5c348fb6b69
feed          sha256:8fb337fd94e1173eaf00e4b6d472169364319e1fec474e701eb66483471dc8d2
comparators   sha256:c3baa72998b01ca1bc7d646b902055d83298b0e14b04696ed403ec3415a06e1d
matcher       0.1.0
exclusions    none
findings      5 total, 3 affected
findingsRoot  sha256:fe78864f47561ca3a8c4cd83d6a24b1991a86100d9c3a42d5e17032dfc87d924
bundle        dumpscan.bundle.json
```

Those digests go into an in-toto predicate, the predicate goes into a DSSE
envelope, and the envelope is signed keylessly with Sigstore against the CI
workflow's own identity. The result is not a report. It is a claim with four
things nailed to it: which bytes were read, which feed was consulted, which
version comparison semantics were used, and which suppressions were applied.

## Part one: where the disagreement actually is

Point another scanner at the same project and dumpscan will tell you exactly
where the two of you part company:

```
$ dumpscan explain dumpscan.bundle.json grype.json
scanner              grype
agreed               1
identifier mismatch  1
feed difference      3
range interpretation 0
suppression          1

  feed-difference      pkg:npm/%40sample/widget@1.4.7 DUMPSCAN-NPM-0002
                       dumpscan has DUMPSCAN-NPM-0002 for this package and the
                       external scanner does not report it
  feed-difference      pkg:npm/polyglot@1.9.0 CVE-2021-22222
                       grype has CVE-2021-22222 for this package and the pinned
                       OSV snapshot has no advisory under that id or any of its aliases
  feed-difference      pkg:npm/polyglot@1.9.0 DUMPSCAN-MULTI-0001
                       dumpscan has DUMPSCAN-MULTI-0001 for this package and the
                       external scanner does not report it
  identifier-mismatch  pkg:generic/node@18.0.0 CVE-2019-11111
                       grype matched node 18.0.0 on cpe-match, and that package
                       is not in the input manifest
  suppression          pkg:npm/cheeseparser@4.17.20 DUMPSCAN-NPM-0003
                       grype reports this and dumpscan reports it as
                       withdrawn-suppressed: advisory was withdrawn at 2025-02-19T08:00:00Z

this report is a diagnostic and is never signed
```

Every discrepancy lands in exactly one of four buckets, and none of them is
"scanners are different". A CPE match against a package that is not in the
lockfile is an identifier problem. An advisory one database has and the other
does not is a feed problem, checked through aliases so a CVE and its GHSA count
as one advisory. A withdrawal one tool honoured and the other did not is a
suppression. The 66 percent stops being a mystery and becomes a list.

This report is never signed. It is a claim about another tool's behaviour, not
about your code, and it should not carry the same weight.

## Part two: the feed moves under you

Here is the part that a timestamped report cannot survive. Same lockfile, same
comparators, same exclusions. One day later.

```
$ dumpscan diff day1.bundle.json day2.bundle.json --snapshot-a snap-day1 --snapshot-b snap-day2
input       same   sha256:725b0669df04cc8794f098f0a163dfe8554f9188e3b2e4073bd6b5c348fb6b69
feed        moved  sha256:8fb337fd94e1173eaf... -> sha256:93ad3d65d1b3c0d7233d...
comparator  same   sha256:c3baa72998b01ca1bc7d646b902055d83298b0e14b04696ed403ec3415a06e1d
exclusions  same   none

2 findings changed
  changed feed        npm cheeseparser 4.17.20 DUMPSCAN-NPM-0001
  changed feed        npm cheeseparser 4.17.20 DUMPSCAN-NPM-0003
```

Three of the four digests did not move, so three of the four cannot be the cause.
The evidence names the field:

```
feed npm cheeseparser 4.17.20 DUMPSCAN-NPM-0001
  /affected/0/ranges/0/events/1/fixed  "4.17.21" -> "5.0.0"
  /severity/0/score                    "...S:U/C:H/I:H/A:H" -> "...S:C/C:H/I:H/A:H"
  /modified                            "2025-01-14T09:00:00Z" -> "2026-09-02T11:00:00Z"

feed npm cheeseparser 4.17.20 DUMPSCAN-NPM-0003
  /withdrawn                           "2025-02-19T08:00:00Z" -> absent
  /modified                            "2025-02-20T10:30:00Z" -> "2026-09-02T11:30:00Z"
```

The first advisory widened its affected range and got rescored. The second one
was un-withdrawn: an advisory somebody retracted in February came back. Neither
of those is a change to your code, and neither of them would have been visible in
a report that pinned only a timestamp. Both of them change whether you are
affected.

The un-withdrawal is the case that convinced me this needed building. dumpscan
keeps withdrawn advisories in the findings set with a `withdrawn-suppressed`
status rather than dropping them, precisely so that the day one of them comes
back, `diff` has something to compare against. A scanner that filters them out
has no way to tell you it happened.

## Part three: replay

Replay is the whole point. Given a bundle, dumpscan fetches the pinned snapshot
by digest, re-parses the input, re-matches with the pinned matcher, and asserts
the root:

```
$ dumpscan replay day1.bundle.json --lockfile package-lock.json
replayed      day1.bundle.json
input         sha256:725b0669df04cc8794f098f0a163dfe8554f9188e3b2e4073bd6b5c348fb6b69
feed          sha256:8fb337fd94e1173eaf00e4b6d472169364319e1fec474e701eb66483471dc8d2
comparators   sha256:c3baa72998b01ca1bc7d646b902055d83298b0e14b04696ed403ec3415a06e1d
findings      5 reproduced
findingsRoot  sha256:fe78864f47561ca3a8c4cd83d6a24b1991a86100d9c3a42d5e17032dfc87d924 matches
```

Point it at the wrong feed and it says so, field by field, instead of just
failing:

```
$ dumpscan replay day1.bundle.json --snapshot snap-day2
feedDigest: recorded sha256:8fb337fd..., observed sha256:93ad3d65...; the
  snapshot supplied is not the one this bundle was scanned against
snapshotManifestDigest: recorded sha256:33b98efe..., observed sha256:01974161...;
  the manifest moved with the feed, which the feed digest already said
findingsRoot: recorded sha256:fe78864f..., observed sha256:a90b6f28...; the
  replayed findings are not the findings this bundle claims
```

And when the installed comparators are not the ones that produced the bundle, it
refuses outright rather than guessing:

```
refusing to replay: the installed comparators order versions differently from the
ones that produced this bundle.
Install the dumpscan that wrote the bundle, or pass --explain to replay anyway
and see what moves.
```

A matching root under different version comparison semantics would be luck, and a
differing one would be unattributable. Neither is worth printing.

## How the determinism is actually enforced

The guarantee is that the same four digests give byte identical findings on any
OS, any Node 22 or later, any locale, any timezone. Saying it is easy. These are
the things that make it true:

- `canon`, `merkle`, `versions`, `match`, and `predicate` are lint-enforced pure.
  `Date.now`, `new Date`, `Math.random`, `process.env`, `Intl`, `localeCompare`,
  `toLocaleLowerCase`, `sort()` without a comparator, and the filesystem and
  network modules are all banned in those packages by rule, not by convention.
- Everything hashed goes through RFC 8785 canonicalization first, with NFC
  normalization applied to strings and to object keys before they are sorted. The
  JCS implementation is fuzz tested against a second implementation written from
  the RFC with its own escape table and its own code unit comparator.
- Comparators are checked against corpora generated from each ecosystem's
  reference implementation, and the hash of those corpora is
  `comparatorRulesetDigest`. A change in ordering is visible even at an unchanged
  package version, and a refactor that preserves ordering is not mistaken for one.
- `pnpm test:determinism` runs the fixture corpus twice, once under `TZ=UTC
LANG=C` and once under `TZ=Pacific/Kiritimati LANG=tr_TR.UTF-8`, and byte
  compares the output. CI runs the same corpus on ubuntu, macos, and windows and
  diffs the three.
- Mutation testing on `versions` and `match` with a floor of 90 percent, because
  a surviving mutant in a version comparator is a silent correctness hole.

One of those caught a real bug while this was being written. The published
snapshot archive was originally a zip, and every JavaScript zip writer derives
its MS-DOS timestamp with `Date` methods that read the local timezone, so the
same snapshot packed in Denver and in Berlin produces different bytes and fails
outright west of UTC. It is now a gzipped tar whose header fields are all
constants. That is exactly the class of bug this project exists to make visible.

## What it deliberately will not do

No `--latest`. No reachability or risk scoring. No dropped findings. No guessing
at a range it cannot evaluate. No wrapping Grype or Trivy. Lockfiles only in v1,
because CycloneDX and SPDX bring back the identifier ambiguity that causes the
chaos in the first place.

## Try it

```
npx dumpscan --help
```

Daily feed snapshots are published to a GitHub release keyed by feed digest, with
a date to digest index, each one signed as its own attestation. Anyone can run
the same workflow against their own bucket. Two independent producers hitting OSV
at the same instant should reach the same digest, and that is itself something
you can check.

---

## Still to do before publishing

Run parts one and two against a real public project rather than the fixtures:

1. Pick a project with a `package-lock.json` and a `requirements.txt` and a real
   history of advisory churn.
2. `grype -o json` and `trivy --format json` over the same tree, then
   `dumpscan explain` against each. Report the real bucket counts.
3. Scan against a published snapshot from a week ago and one from today, then
   `dumpscan diff` the two bundles with both snapshots available, and name the
   advisories that actually moved.

The numbers above are from this repository's own fixtures and are labelled as
such. Do not ship the post with fixture numbers presented as a real project.
