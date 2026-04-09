#!/usr/bin/env bash
# @name: Agent List
# @description: Verify ralph agent list shows built-in agents

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Scenario: Agent List ==="
echo "Running ralph agent list..."

cd "$REPO_ROOT"

# Build first to ensure latest changes are available
npm run build --silent 2>/dev/null

OUTPUT=$(ralph agent list 2>&1)

# Assert built-in agents appear
echo "$OUTPUT" | grep -q "implement" || { echo "FAIL: implement not found"; exit 1; }
echo "$OUTPUT" | grep -q "plan" || { echo "FAIL: plan not found"; exit 1; }
echo "$OUTPUT" | grep -q "meditate" || { echo "FAIL: meditate not found"; exit 1; }
echo "$OUTPUT" | grep -q "agent-creator" || { echo "FAIL: agent-creator not found"; exit 1; }

echo ""
echo "=== PASS: all built-in agents listed ==="
