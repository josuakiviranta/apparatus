#!/usr/bin/env bash
# Smoke driver for trace-renderer-strip-ceremony.
#
# Steps:
#   1. setup-fixture.sh stages a synthetic run dir under $base
#   2. apparat pipeline trace (default + --full) diffed against
#      expected-default.txt / expected-full.txt
#   3. cleaner-contract.mjs verifies cleanJsonlEvents end-to-end on the
#      synthetic raw-attempt-1.txt
#
# Requires: dist/ built (npm run build) so cleaner-contract.mjs can import
# the compiled cleanJsonlEvents. The CI driver builds first.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repoRoot="$(cd "${here}/../../.." && pwd)"
base="$(mktemp -d)"
trap 'rm -rf "${base}"' EXIT

bash "${here}/setup-fixture.sh" "${base}"
runId="trace-smoke-deadbeef"

apparatBin="${repoRoot}/dist/cli/index.js"
if [[ ! -f "${apparatBin}" ]]; then
  echo "build dist first: npm run build" >&2
  exit 2
fi

defaultOut="$(node "${apparatBin}" pipeline trace "${runId}" --project "${base}")"
fullOut="$(node "${apparatBin}" pipeline trace "${runId}" --project "${base}" --full)"

diff -u "${here}/expected-default.txt" <(printf '%s\n' "${defaultOut}")
diff -u "${here}/expected-full.txt"    <(printf '%s\n' "${fullOut}")

node "${here}/cleaner-contract.mjs" "${base}"

echo "trace-renderer-strip-ceremony: OK"
