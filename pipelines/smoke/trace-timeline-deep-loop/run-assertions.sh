#!/usr/bin/env bash
# Smoke driver for trace-timeline-deep-loop.
# Requires: dist/ built (npm run build). CI driver builds first.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repoRoot="$(cd "${here}/../../.." && pwd)"
base="$(mktemp -d)"
trap 'rm -rf "${base}"' EXIT

bash "${here}/setup-fixture.sh" "${base}"
runId="trace-timeline-smoke-deadc0de"

apparatBin="${repoRoot}/dist/cli/index.js"
if [[ ! -f "${apparatBin}" ]]; then
  echo "build dist first: npm run build" >&2
  exit 2
fi

timelineOut="$(node "${apparatBin}" pipeline trace "${runId}" --project "${base}" --timeline)"
conflictReceive="$(node "${apparatBin}" pipeline trace "${runId}" --project "${base}" --timeline --node-receive implement-1 2>&1 || true)"
conflictFull="$(node "${apparatBin}" pipeline trace "${runId}" --project "${base}" --timeline --full 2>&1 || true)"

diff -u "${here}/expected-timeline.txt"         <(printf '%s\n' "${timelineOut}")
diff -u "${here}/expected-conflict-receive.txt" <(printf '%s\n' "${conflictReceive}")
diff -u "${here}/expected-conflict-full.txt"    <(printf '%s\n' "${conflictFull}")

echo "trace-timeline-deep-loop: OK"
