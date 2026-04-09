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

  ralph pipeline run "$dotfile" "${extra_args[@]}" 2>&1 | tee "$tmpout"
  local exit_code="${PIPESTATUS[0]}"
  if [[ "$exit_code" -eq 0 ]]; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name (exit $exit_code, output saved: $tmpout)"
    FAIL=$((FAIL + 1))
  fi
}

run_scenario "smoke"     "$ATTRACTOR_DIR/smoke.dot"
run_scenario "work_test" "$ATTRACTOR_DIR/work_test.dot" --project "$REPO_ROOT"
run_scenario "gate_test" "$ATTRACTOR_DIR/gate_test.dot" --project "$REPO_ROOT"

# Agent attribute validation test (validates DOT parsing without spawning claude)
echo ""
echo "=== Scenario: agent_validate ==="
if ralph pipeline validate "$ATTRACTOR_DIR/agent_test.dot" 2>&1; then
  echo "PASS: agent_validate"
  PASS=$((PASS + 1))
else
  echo "FAIL: agent_validate"
  FAIL=$((FAIL + 1))
fi

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
