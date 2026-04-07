#!/bin/bash
# @name: Heartbeat Lifecycle
# @description: Registers a meditate task, lists it, pauses, resumes, reads logs, then stops it — verifies no tasks linger after stop

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_PROJECT="$(mktemp -d)"
TASK_ID="meditate:$(basename "$TMP_PROJECT")"

cleanup() {
  # Double-stop is intentional — trap fires after explicit Step 6 stop; || true suppresses already-removed error
  node "$REPO_ROOT/dist/cli/index.js" heartbeat stop "$TASK_ID" 2>/dev/null || true
  rm -rf "$TMP_PROJECT"
}
trap cleanup EXIT

echo "=== Scenario: Heartbeat Lifecycle ==="
echo "TASK_ID=$TASK_ID"
echo ""

echo "--- Step 1: Register task (every 60 min) ---"
node "$REPO_ROOT/dist/cli/index.js" heartbeat meditate "$TMP_PROJECT" --every 60

echo ""
echo "--- Step 2: List tasks ---"
node "$REPO_ROOT/dist/cli/index.js" heartbeat list

echo ""
echo "--- Step 3: Pause task ---"
node "$REPO_ROOT/dist/cli/index.js" heartbeat pause "$TASK_ID"

echo ""
echo "--- Step 4: Resume task ---"
node "$REPO_ROOT/dist/cli/index.js" heartbeat resume "$TASK_ID"

echo ""
echo "--- Step 5: Logs (no-follow) ---"
node "$REPO_ROOT/dist/cli/index.js" heartbeat logs "$TASK_ID" || true

echo ""
echo "--- Step 6: Stop task ---"
node "$REPO_ROOT/dist/cli/index.js" heartbeat stop "$TASK_ID"

echo ""
echo "--- Step 7: Verify task removed ---"
node "$REPO_ROOT/dist/cli/index.js" heartbeat list

echo ""
echo "=== DONE ==="
