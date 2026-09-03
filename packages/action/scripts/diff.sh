#!/usr/bin/env bash
# Diffs this run's bundle against the base branch's last successful one. An
# unexplained divergence is exit 3 and is always a hard failure: it means
# dumpscan could not account for a change, which is a bug rather than a finding.
set -euo pipefail

run() {
  if [[ "${DUMPSCAN_VERSION}" == "link" ]]; then
    dumpscan "$@"
  else
    npx --yes "dumpscan@${DUMPSCAN_VERSION}" "$@"
  fi
}

args=(diff "$DUMPSCAN_BASE_BUNDLE" "$DUMPSCAN_BUNDLE")
[[ -n "${DUMPSCAN_BASE_SNAPSHOT:-}" ]] && args+=(--snapshot-a "$DUMPSCAN_BASE_SNAPSHOT")
[[ -n "${DUMPSCAN_SNAPSHOT:-}" ]] && args+=(--snapshot-b "$DUMPSCAN_SNAPSHOT")

set +e
run "${args[@]}" | tee dumpscan-diff.txt
status=${PIPESTATUS[0]}
set -e

{
  echo
  echo "### dumpscan diff"
  echo
  echo '```'
  cat dumpscan-diff.txt
  echo '```'
} >> "$GITHUB_STEP_SUMMARY"

if [[ $status -eq 3 ]]; then
  echo "::error::dumpscan could not attribute a changed finding to any pinned input" >&2
  exit 3
fi
exit 0
