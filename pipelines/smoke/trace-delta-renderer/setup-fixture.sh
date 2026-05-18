#!/usr/bin/env bash
# Pre-stages a synthetic apparat run dir for the trace-delta-renderer smoke
# fixture. No claude subprocess is spawned — the run dir is hand-crafted.

set -euo pipefail

base="${1:-/tmp/apparat-trace-delta-smoke}"
runId="trace-delta-smoke-cafef00d"
runDir="${base}/.apparat/runs/${runId}"
mkdir -p "${runDir}"

cat > "${runDir}/pipeline.jsonl" <<'JSONL'
{"kind":"pipeline-start","runId":"trace-delta-smoke-cafef00d","graph":{"name":"trace-delta-renderer","nodes":["start","demo","tail"]},"timestamp":"2026-05-18T00:00:00.000Z"}
{"kind":"node-start","nodeId":"start","nodeReceiveId":"start-1","nodeKind":"tool","timestamp":"2026-05-18T00:00:01.000Z","contextSnapshot":{}}
{"kind":"node-end","nodeId":"start","nodeReceiveId":"start-1","success":true,"contextUpdates":{"$goal":"demo"},"timestamp":"2026-05-18T00:00:02.000Z"}
{"kind":"node-start","nodeId":"demo","nodeReceiveId":"demo-1","nodeKind":"agent","timestamp":"2026-05-18T00:00:03.000Z","contextSnapshot":{"$goal":"demo"}}
{"kind":"node-end","nodeId":"demo","nodeReceiveId":"demo-1","success":true,"contextUpdates":{"demo.path":"X"},"timestamp":"2026-05-18T00:00:04.000Z"}
{"kind":"node-start","nodeId":"tail","nodeReceiveId":"tail-1","nodeKind":"tool","timestamp":"2026-05-18T00:00:05.000Z","contextSnapshot":{"$goal":"demo","demo.path":"X"}}
{"kind":"node-end","nodeId":"tail","nodeReceiveId":"tail-1","success":true,"contextUpdates":{},"timestamp":"2026-05-18T00:00:06.000Z"}
{"kind":"pipeline-end","runId":"trace-delta-smoke-cafef00d","outcome":"success","timestamp":"2026-05-18T00:00:07.000Z"}
JSONL

echo "fixture staged at ${runDir}"
echo "runId=${runId}"
