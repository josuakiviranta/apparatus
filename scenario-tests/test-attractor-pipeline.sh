#!/usr/bin/env bash
# @name: attractor pipeline end-to-end scenarios
# @description: Runs three ralph pipeline scenarios (smoke, work node, human gate).
#               Each scenario runs independently — a failure does not abort others.
#               Prints PASS/FAIL summary and path to the latest JSONL trace.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ATTRACTOR_DIR="$REPO_ROOT/scenario-tests/attractor"

PASS=0
FAIL=0
TMPFILES=()

run_scenario() {
  local name="$1"
  local dotfile="$2"
  shift 2
  local extra_args=("$@")

  echo ""
  echo "=== Scenario: $name ==="
  local tmpout
  tmpout=$(mktemp)
  TMPFILES+=("$tmpout")

  if ralph pipeline run "$dotfile" "${extra_args[@]}" 2>&1 | tee "$tmpout"; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name (output saved: $tmpout)"
    FAIL=$((FAIL + 1))
  fi
}

run_scenario "smoke"     "$ATTRACTOR_DIR/smoke.dot"
run_scenario "work_test" "$ATTRACTOR_DIR/work_test.dot" --project "$REPO_ROOT"
run_scenario "gate_test" "$ATTRACTOR_DIR/gate_test.dot" --project "$REPO_ROOT"

echo ""
echo "Results: $PASS passed, $FAIL failed"
echo ""

# Emit latest JSONL trace path for the investigator subagent
LATEST_JSONL=$(ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1)
if [[ -n "$LATEST_JSONL" ]]; then
  echo "Latest JSONL trace: $LATEST_JSONL"
else
  echo "No JSONL trace found under ~/.claude/projects/"
fi

# Clean up temp files after summary is printed
rm -f "${TMPFILES[@]}"

[[ $FAIL -eq 0 ]]
