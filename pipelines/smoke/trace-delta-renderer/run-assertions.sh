#!/usr/bin/env bash
# Smoke driver for trace-delta-renderer.
# Requires: dist/ built (npm run build). CI driver builds first.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repoRoot="$(cd "${here}/../../.." && pwd)"
base="$(mktemp -d)"
trap 'rm -rf "${base}"' EXIT

bash "${here}/setup-fixture.sh" "${base}"
runId="trace-delta-smoke-cafef00d"

apparatBin="${repoRoot}/dist/cli/index.js"
if [[ ! -f "${apparatBin}" ]]; then
  echo "build dist first: npm run build" >&2
  exit 2
fi

defaultOut="$(node "${apparatBin}" pipeline trace "${runId}" --project "${base}")"
fullOut="$(node "${apparatBin}" pipeline trace "${runId}" --project "${base}" --full)"

diff -u "${here}/expected-default.txt" <(printf '%s\n' "${defaultOut}")
diff -u "${here}/expected-full.txt"    <(printf '%s\n' "${fullOut}")

echo "trace-delta-renderer: OK"
