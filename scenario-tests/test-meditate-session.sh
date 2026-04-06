#!/bin/bash
# @name: Meditate Session Orchestration
# @description: Verifies runMeditationSession spawns subprocess, emits tool indicators, and handles exit codes correctly via RALPH_TEST_CMD stub

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Scenario: Meditate session tool-use indicator ==="
echo "Running vitest for runMeditationSession scenario tests..."

cd "$REPO_ROOT"
npx vitest run src/cli/tests/meditate.test.ts --reporter=verbose 2>&1

echo ""
echo "=== PASS: runMeditationSession scenario tests completed ==="
