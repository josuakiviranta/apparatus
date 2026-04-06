#!/bin/bash
# @name: run-scenarios Command End-to-End
# @description: Scaffolds a temp project with scenario-tests/, runs a stub scenario, and asserts a report file is written to scenario-runs/

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_PROJECT="$(mktemp -d)"
trap "rm -rf $TMP_PROJECT" EXIT

echo "=== Scenario: run-scenarios creates report file ==="

# Create a minimal scenario test in the temp project
mkdir -p "$TMP_PROJECT/scenario-tests"
cat > "$TMP_PROJECT/scenario-tests/test-stub.sh" << 'STUB'
#!/bin/bash
# @name: Stub Scenario
# @description: Always passes, used for end-to-end harness test
echo "Stub scenario ran successfully"
exit 0
STUB
chmod +x "$TMP_PROJECT/scenario-tests/test-stub.sh"

echo "Running: ralph run-scenarios $TMP_PROJECT --all"
node "$REPO_ROOT/dist/cli/index.js" run-scenarios "$TMP_PROJECT" --all

echo ""
echo "Checking for report in scenario-runs/..."
REPORT_COUNT=$(ls "$TMP_PROJECT/scenario-runs/"*.md 2>/dev/null | wc -l | tr -d ' ')

if [ "$REPORT_COUNT" -eq 0 ]; then
  echo "FAIL: No report file found in scenario-runs/"
  exit 1
fi

echo "Found $REPORT_COUNT report file(s):"
ls "$TMP_PROJECT/scenario-runs/"*.md

echo ""
echo "=== PASS: run-scenarios wrote report to scenario-runs/ ==="
