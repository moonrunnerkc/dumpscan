/** The text `dumpscan --help` prints. */
export const HELP = `dumpscan - a vulnerability scanner whose every result is a reproducible, signed claim

usage: dumpscan <command> [options]

commands:
  snapshot   Build a feed snapshot from OSV or from a local mirror
  scan       Scan a lockfile against a pinned snapshot
  replay     Re-derive a bundle's findings from its pinned inputs
  verify     Check a bundle's signature, identity, and digests
  diff       Attribute every changed finding to exactly one pinned input
  prove      Emit a Merkle inclusion proof for a finding and its advisory
  explain    Bucket every disagreement with Grype or Trivy
  publish    Pack, sign, and index a snapshot for a store

dumpscan snapshot [--ecosystems <list>] [--from <dir>] [--out <dir>] [--base-url <url>]
  Downloads the OSV archives and builds a content addressed snapshot, or builds
  from a directory of records with --from and never touches the network.
  Prints the feed digest.

    dumpscan snapshot --ecosystems npm,PyPI --out ./snapshot

dumpscan scan <lockfile> --snapshot <digest|path> [options]
  --snapshot <digest|path>  Required. dumpscan never picks a snapshot for you.
  --workspace <path>        Which resolved package set to scan. Defaults to '.'.
  --out <path>              Bundle to write. Defaults to dumpscan.bundle.json.
  --findings <path>         Also write the findings on their own.
  --sarif <path>            Also write SARIF 2.1.0 for code scanning.
  --sign                    Sign keylessly with Sigstore.
  --identity-token <jwt>    OIDC token for keyless signing.
  --exclusions <path>       dumpscan.exclusions.json or an OpenVEX document.
  --key <path>              Sign with a plain ed25519 key instead. Opt in only.
  --public-key <path>       Public key to record. Derived from --key by default.

    dumpscan scan package-lock.json --snapshot sha256:77f3f140... --sign

dumpscan replay <bundle> [--lockfile <path>] [--snapshot <digest|path>] [--exclusions <path>]
  Resolves the pinned snapshot, re-parses the input, re-matches, and asserts the
  findings root. Refuses when the installed comparator ruleset differs from the
  one that produced the bundle, unless --explain is passed. Names which of the
  four digests moved on any mismatch.

    dumpscan replay dumpscan.bundle.json --lockfile package-lock.json

dumpscan verify <bundle> [--identity <pattern>] [--issuer <url>] [--tuf-cache <dir>]
  Checks the signature, the certificate identity, log inclusion, and that the
  findings in the file hash to the findingsRoot the statement claims.
  Never re-scans.

    dumpscan verify dumpscan.bundle.json --issuer https://token.actions.githubusercontent.com

dumpscan diff <bundle-a> <bundle-b> [--snapshot-a <path>] [--snapshot-b <path>]
  Compares the four pinned digests, then attributes every changed finding to
  exactly one of them: the input, the feed, the comparators, or the exclusions.
  A change nothing explains exits 3, because that is a bug in dumpscan rather
  than a fact about the two scans.

    dumpscan diff before.bundle.json after.bundle.json --snapshot-b ./snapshot

dumpscan prove <bundle> <advisory-id> [--snapshot <digest|path>]
  Emits the inclusion proof for a finding against the findings root, and with
  --snapshot the proof that the advisory is in the feed.

    dumpscan prove dumpscan.bundle.json GHSA-aaaa-bbbb-cccc --snapshot ./snapshot

dumpscan explain <bundle> <grype-or-trivy-json>
  Aligns another scanner's findings to the manifest dumpscan scanned and buckets
  every disagreement as an identifier mismatch, a feed difference, a range
  interpretation, or a suppression. Never signed: it is a claim about another
  tool, not about the code.

    dumpscan explain dumpscan.bundle.json grype.json

dumpscan publish <snapshot-dir> --out <dir> --date <YYYY-MM-DD> [--sign]
  Packs the snapshot into a deterministic archive named after its feed digest,
  signs its manifest as an attestation of its own, and updates the date to
  digest index. Publishing the bytes is the workflow's job.

    dumpscan publish ./snapshot --out ./release --date 2026-09-03 --sign

snapshot store options, accepted by scan, replay, prove, and diff:
  --store <url>              Base URL of a snapshot store. May repeat.
                             DUMPSCAN_STORES holds a comma separated list.
  --cache <dir>              Where fetched snapshots are cached.
  --snapshot-issuer <url>    Expected issuer of a snapshot attestation.
  --snapshot-identity <id>   Expected identity of a snapshot attestation.
  --insecure                 Skip snapshot attestation verification. Opt in only.

global options:
  --json     Machine readable output
  --help     This text
  --version  Print the dumpscan version

exit codes:
  0  success
  1  findings present, or a verification or replay mismatch
  2  usage error, or a run that could not finish
  3  unexplained divergence in diff
`;
