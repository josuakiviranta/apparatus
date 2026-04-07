#!/bin/bash
# @name: Meditate Create Subcommand
# @description: Verifies ralph meditate create unit behavior — argument parsing, kickoff args, and session handling — via vitest

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Scenario: Meditate Create Subcommand ==="
echo "Running vitest for meditateCreateCommand tests..."

cd "$REPO_ROOT"
npx vitest run src/cli/tests/meditate-create.test.ts --reporter=verbose 2>&1

echo ""
echo "=== PASS: meditate create tests completed ==="
