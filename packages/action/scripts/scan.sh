#!/usr/bin/env bash
# Runs dumpscan scan, signs keylessly when asked, and reports the pinned digests
# as step outputs so later steps and other jobs can use them.
set -euo pipefail

# "link" runs whatever dumpscan is already on PATH, which is how this repo
# exercises the action against its own build before anything is published.
run() {
  if [[ "${DUMPSCAN_VERSION}" == "link" ]]; then
    dumpscan "$@"
  else
    npx --yes "dumpscan@${DUMPSCAN_VERSION}" "$@"
  fi
}

args=(scan "$DUMPSCAN_LOCKFILE" --snapshot "$DUMPSCAN_SNAPSHOT" --out "$DUMPSCAN_BUNDLE" --json)
[[ -n "${DUMPSCAN_WORKSPACE:-}" ]] && args+=(--workspace "$DUMPSCAN_WORKSPACE")
[[ -n "${DUMPSCAN_EXCLUSIONS:-}" ]] && args+=(--exclusions "$DUMPSCAN_EXCLUSIONS")
[[ "${DUMPSCAN_SIGN:-true}" == "true" ]] && args+=(--sign)

# Exit 1 means findings are present, which is a result rather than a failure.
# The gate step decides whether findings should fail the check.
set +e
run "${args[@]}" > dumpscan-scan.json
status=$?
set -e
if [[ $status -ne 0 && $status -ne 1 ]]; then
  echo "dumpscan scan failed with exit code $status" >&2
  cat dumpscan-scan.json >&2 || true
  exit $status
fi

feed=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("dumpscan-scan.json","utf8")).statement.predicate.feedDigest)')
root=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("dumpscan-scan.json","utf8")).statement.predicate.findingsRoot)')
affected=$(node -e 'const r=JSON.parse(require("node:fs").readFileSync("dumpscan-scan.json","utf8"));process.stdout.write(String(r.findings.filter(f=>f.status==="affected").length))')

{
  echo "bundle=$DUMPSCAN_BUNDLE"
  echo "feed-digest=$feed"
  echo "findings-root=$root"
  echo "affected=$affected"
} >> "$GITHUB_OUTPUT"

{
  echo "### dumpscan"
  echo
  echo "| pinned | value |"
  echo "| --- | --- |"
  echo "| feed | \`$feed\` |"
  echo "| findings root | \`$root\` |"
  echo "| affected | $affected |"
} >> "$GITHUB_STEP_SUMMARY"

if [[ -n "${DUMPSCAN_SARIF:-}" ]]; then
  node "$(dirname "${BASH_SOURCE[0]}")/to-sarif.mjs" dumpscan-scan.json "$DUMPSCAN_SARIF"
fi
