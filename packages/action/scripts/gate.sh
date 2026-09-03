#!/usr/bin/env bash
# Fails the check when the scan found an affected finding no exclusion covers.
set -euo pipefail

if [[ "${DUMPSCAN_AFFECTED:-0}" -gt 0 ]]; then
  echo "::error::dumpscan found ${DUMPSCAN_AFFECTED} affected finding(s) not covered by an exclusion; see ${DUMPSCAN_BUNDLE}" >&2
  exit 1
fi
echo "no affected findings"
