#!/usr/bin/env bash
# @name: Agent Show
# @description: Verify ralph agent show displays agent details

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Scenario: Agent Show ==="

cd "$REPO_ROOT"

# Build first to ensure latest changes are available
npm run build --silent 2>/dev/null

# Show implement agent
echo "Testing: ralph agent show implement"
OUTPUT=$(ralph agent show implement 2>&1)

echo "$OUTPUT" | grep -q "implement" || { echo "FAIL: name not shown"; exit 1; }
echo "$OUTPUT" | grep -q "opus" || { echo "FAIL: model not shown"; exit 1; }
echo "$OUTPUT" | grep -q "Prompt" || { echo "FAIL: prompt section missing"; exit 1; }

# Show unknown agent should fail
echo "Testing: ralph agent show nonexistent (should fail)"
set +e
ralph agent show nonexistent 2>&1
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "FAIL: should have errored for unknown agent"
  exit 1
fi

echo ""
echo "=== PASS: agent show works correctly ==="
