/** The text `dumpscan --help` prints. */
export const HELP = `dumpscan - a vulnerability scanner whose every result is a reproducible, signed claim

usage: dumpscan <command> [options]

commands:
  snapshot   Build a feed snapshot from OSV or from a local mirror
  scan       Scan a lockfile against a pinned snapshot
  verify     Check a bundle's signature, identity, and digests
  prove      Emit a Merkle inclusion proof for a finding and its advisory

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
  --sign                    Sign keylessly with Sigstore.
  --identity-token <jwt>    OIDC token for keyless signing.
  --key <path>              Sign with a plain ed25519 key instead. Opt in only.
  --public-key <path>       Public key to record. Derived from --key by default.

    dumpscan scan package-lock.json --snapshot sha256:77f3f140... --sign

dumpscan verify <bundle> [--identity <pattern>] [--issuer <url>] [--tuf-cache <dir>]
  Checks the signature, the certificate identity, log inclusion, and that the
  findings in the file hash to the findingsRoot the statement claims.
  Never re-scans.

    dumpscan verify dumpscan.bundle.json --issuer https://token.actions.githubusercontent.com

dumpscan prove <bundle> <advisory-id> [--snapshot <digest|path>]
  Emits the inclusion proof for a finding against the findings root, and with
  --snapshot the proof that the advisory is in the feed.

    dumpscan prove dumpscan.bundle.json GHSA-aaaa-bbbb-cccc --snapshot ./snapshot

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
