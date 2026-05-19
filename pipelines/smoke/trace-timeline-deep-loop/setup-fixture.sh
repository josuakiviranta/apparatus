#!/usr/bin/env bash
# Pre-stages a synthetic apparat run dir for the trace-timeline-deep-loop
# smoke fixture. No claude subprocess is spawned — the run dir is
# hand-crafted. Sibling of pipelines/smoke/trace-delta-renderer/setup-fixture.sh.

set -euo pipefail

base="${1:-/tmp/apparat-trace-timeline-smoke}"
runId="trace-timeline-smoke-deadc0de"
runDir="${base}/.apparat/runs/${runId}"
implementDir="${runDir}/implement"
mkdir -p "${implementDir}"

cat > "${runDir}/pipeline.jsonl" <<'JSONL'
{"kind":"pipeline-start","runId":"trace-timeline-smoke-deadc0de","graph":{"name":"trace-timeline-deep-loop","nodes":["start","implement"]},"timestamp":"2026-05-19T00:00:00.000Z"}
{"kind":"node-start","nodeId":"start","nodeReceiveId":"start-1","nodeKind":"tool","timestamp":"2026-05-19T00:00:01.000Z","contextSnapshot":{}}
{"kind":"node-end","nodeId":"start","nodeReceiveId":"start-1","success":true,"contextUpdates":{},"timestamp":"2026-05-19T00:00:02.000Z"}
{"kind":"node-start","nodeId":"implement","nodeReceiveId":"implement-1","nodeKind":"looping-agent","timestamp":"2026-05-19T00:00:03.000Z","contextSnapshot":{}}
{"kind":"node-end","nodeId":"implement","nodeReceiveId":"implement-1","success":true,"contextUpdates":{},"timestamp":"2026-05-19T00:00:09.000Z"}
{"kind":"pipeline-end","runId":"trace-timeline-smoke-deadc0de","outcome":"success","timestamp":"2026-05-19T00:00:10.000Z"}
JSONL

cat > "${implementDir}/raw-attempt-1.txt" <<'JSONL'
{"type":"assistant","timestamp":"2026-05-19T00:00:04.000Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{"file_path":"plan.md"}}]}}
JSONL

cat > "${implementDir}/raw-attempt-2.txt" <<'JSONL'
{"type":"assistant","timestamp":"2026-05-19T00:00:07.000Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{"file_path":"plan.md"}}]}}
JSONL

echo "fixture staged at ${runDir}"
echo "runId=${runId}"
