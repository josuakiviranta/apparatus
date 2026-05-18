#!/usr/bin/env bash
# Pre-stages a synthetic apparat run dir for the trace-renderer-strip-ceremony
# smoke fixture. No claude subprocess is spawned — the run dir is hand-crafted.
#
# Layout (relative to fixture base $1):
#   $1/.apparat/runs/trace-smoke-deadbeef/
#     pipeline.jsonl                      — synthetic apparat frames (no ceremony)
#     demo/raw-attempt-1.txt              — synthetic raw-attempt with ceremony

set -euo pipefail

base="${1:-/tmp/apparat-trace-smoke}"
runId="trace-smoke-deadbeef"
runDir="${base}/.apparat/runs/${runId}"
mkdir -p "${runDir}/demo"

# pipeline.jsonl — only apparat frames. The cleaner is a no-op against these
# because the apparat tracer never emits ceremony into pipeline.jsonl. The
# integration path verifies the seam doesn't crash + the surface is stable.
cat > "${runDir}/pipeline.jsonl" <<'JSONL'
{"kind":"pipeline-start","runId":"trace-smoke-deadbeef","graph":{"name":"trace-renderer-strip-ceremony","nodes":[]},"timestamp":"2026-05-18T00:00:00.000Z"}
{"kind":"node-start","nodeId":"demo","nodeReceiveId":"demo-1","nodeKind":"agent","timestamp":"2026-05-18T00:00:01.000Z","contextSnapshot":{}}
{"kind":"node-end","nodeId":"demo","nodeReceiveId":"demo-1","success":true,"contextUpdates":{},"timestamp":"2026-05-18T00:00:02.000Z"}
{"kind":"pipeline-end","runId":"trace-smoke-deadbeef","outcome":"success","timestamp":"2026-05-18T00:00:03.000Z"}
JSONL

# demo/raw-attempt-1.txt — synthetic Claude Code raw-attempt with ceremony.
# 11 lines mirroring the design § 1 sample structure.
cat > "${runDir}/demo/raw-attempt-1.txt" <<'JSONL'
{"type":"system","subtype":"hook_started","hook_id":"h1","hook_name":"SessionStart:startup"}
{"type":"system","subtype":"hook_started","hook_id":"h2","hook_name":"SessionStart:startup"}
{"type":"system","subtype":"hook_started","hook_id":"h3","hook_name":"SessionStart:startup"}
{"type":"system","subtype":"hook_response","hook_id":"h1","output":"{\"additional_context\":\"<SKILL_PRELUDE_BODY>\"}"}
{"type":"system","subtype":"hook_response","hook_id":"h2","output":"{}"}
{"type":"system","subtype":"hook_response","hook_id":"h3","output":"{}"}
{"type":"rate_limit_event","model":"claude","remaining":9999}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"u1","content":"ok"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_result","tool_use_id":"u1","content":"ok"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"u2","name":"Read","input":{}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}
JSONL

echo "fixture staged at ${runDir}"
echo "runId=${runId}"
