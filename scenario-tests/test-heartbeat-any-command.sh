#!/usr/bin/env bash
# @name: Heartbeat Any Command
# @description: Verifies that heartbeat can register implement, run-scenarios, and pipeline
#               tasks — checks correct task IDs and full lifecycle (register/list/stop).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RALPH="node $REPO_ROOT/dist/cli/index.js"
TMP_PROJECT="$(mktemp -d)"
PROJ_NAME="$(basename "$TMP_PROJECT")"
ATTRACTOR_DIR="$REPO_ROOT/scenario-tests/attractor"

IMPLEMENT_ID="implement:$PROJ_NAME"
SCENARIOS_ID="run-scenarios:$PROJ_NAME"
PIPELINE_ID="pipeline:smoke"

cleanup() {
  $RALPH heartbeat stop "$IMPLEMENT_ID"  2>/dev/null || true
  $RALPH heartbeat stop "$SCENARIOS_ID" 2>/dev/null || true
  $RALPH heartbeat stop "$PIPELINE_ID"  2>/dev/null || true
  rm -rf "$TMP_PROJECT"
}
trap cleanup EXIT

echo "=== Scenario: Heartbeat Any Command ==="
echo "TMP_PROJECT=$TMP_PROJECT"
echo ""

# ── implement ──────────────────────────────────────────────────────────────────
echo "--- Step 1: Register heartbeat implement ---"
$RALPH heartbeat implement "$TMP_PROJECT" --every 9999

echo ""
echo "--- Step 2: List tasks — expect implement:$PROJ_NAME ---"
OUTPUT=$($RALPH heartbeat list)
echo "$OUTPUT"
echo "$OUTPUT" | grep -q "$IMPLEMENT_ID" || { echo "FAIL: $IMPLEMENT_ID not found in list"; exit 1; }

echo ""
echo "--- Step 3: Stop implement task ---"
$RALPH heartbeat stop "$IMPLEMENT_ID"

echo ""
echo "--- Step 4: Verify implement task removed ---"
$RALPH heartbeat list | grep -vq "$IMPLEMENT_ID" || { echo "FAIL: $IMPLEMENT_ID still listed after stop"; exit 1; }

# ── run-scenarios ──────────────────────────────────────────────────────────────
echo ""
echo "--- Step 5: Register heartbeat run-scenarios ---"
$RALPH heartbeat run-scenarios "$TMP_PROJECT" --every 9999

echo ""
echo "--- Step 6: List tasks — expect run-scenarios:$PROJ_NAME ---"
OUTPUT=$($RALPH heartbeat list)
echo "$OUTPUT"
echo "$OUTPUT" | grep -q "$SCENARIOS_ID" || { echo "FAIL: $SCENARIOS_ID not found in list"; exit 1; }

echo ""
echo "--- Step 7: Stop run-scenarios task ---"
$RALPH heartbeat stop "$SCENARIOS_ID"

# ── pipeline ───────────────────────────────────────────────────────────────────
echo ""
echo "--- Step 8: Register heartbeat pipeline (smoke.dot) ---"
$RALPH heartbeat pipeline "$ATTRACTOR_DIR/smoke.dot" --project "$TMP_PROJECT" --every 9999

echo ""
echo "--- Step 9: List tasks — expect pipeline:smoke (NOT pipeline:run) ---"
OUTPUT=$($RALPH heartbeat list)
echo "$OUTPUT"
echo "$OUTPUT" | grep -q "$PIPELINE_ID"    || { echo "FAIL: $PIPELINE_ID not found in list"; exit 1; }
echo "$OUTPUT" | grep -vq "pipeline:run"   || { echo "FAIL: pipeline:run found — ID generation broken"; exit 1; }

echo ""
echo "--- Step 10: Pause and resume pipeline task ---"
$RALPH heartbeat pause "$PIPELINE_ID"
$RALPH heartbeat list | grep -q "paused" || { echo "FAIL: task not paused"; exit 1; }
$RALPH heartbeat resume "$PIPELINE_ID"

echo ""
echo "--- Step 11: Stop pipeline task ---"
$RALPH heartbeat stop "$PIPELINE_ID"

echo ""
echo "=== DONE — all assertions passed ==="
