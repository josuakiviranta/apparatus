# Scenario Tests for ralph Commands

**Date:** 2026-04-07
**Status:** Approved

## Overview

Add two new scenario test scripts to `scenario-tests/` that cover the `heartbeat` subcommand lifecycle and `meditate create` subcommand. These join the three existing scenario tests (`test-meditate-session.sh`, `test-run-scenarios.sh`, `test-stream-formatter.sh`).

Excluded from scope: `plan`, `implement`, `new`, `heartbeat watch` (interactive or spawns Claude internally).

## Scenario Test Format

All scenario tests are shell scripts discovered by `ralph run-scenarios`. Each must have a `@name` and `@description` header in the first 10 lines. `ralph run-scenarios` builds a Claude prompt from those headers plus the script path and output path, then spawns a Claude session to run the script and write a structured markdown report to `scenario-runs/`.

## New Scenario 1: Heartbeat Lifecycle

**File:** `scenario-tests/test-heartbeat-lifecycle.sh`

**Purpose:** Verify the full `heartbeat` subcommand flow runs without errors and leaves no lingering background processes.

**Subcommands covered:** `meditate` (register), `list`, `pause`, `resume`, `logs`, `stop`

**Script design:**
- Creates a temp project dir via `mktemp -d`
- Registers a `trap` at the top that runs `ralph heartbeat stop <id>` on exit — guarantees cleanup regardless of failure
- Runs each subcommand in sequence against the temp project dir, using `--every 60` for the register step (a 60-minute interval so it never actually fires during the test)
- Echoes each command before running it so Claude can observe the output per step
- Ends with explicit `ralph heartbeat stop <id>` before the trap fires

Claude observes the stdout of each subcommand and reports a pass/fail finding per subcommand in the report.

**No-linger guarantee:** The `trap` on EXIT combined with the explicit stop at the end ensures the daemon task is removed whether the script succeeds, fails, or is interrupted.

## New Scenario 2: Meditate Create

**File:** `scenario-tests/test-meditate-create.sh`

**Purpose:** Verify `ralph meditate create` unit behavior — argument parsing, prompt construction, and kickoff args — via vitest.

**Script design:**
- Delegates to `npx vitest run src/cli/tests/meditate-create.test.ts --reporter=verbose`
- Same pattern as the existing `test-meditate-session.sh`
- Does not spawn a real Claude session (the command is interactive; vitest uses stubs)

Claude runs vitest, observes which tests pass or fail, and reports the results.

## Report Structure

Each scenario produces a markdown report in `scenario-runs/` with the standard structure Claude writes:

```
---
date: <timestamp>
scenario: <@name>
script: <path>
status: pass | fail
---

# <name>

## What ran
## What happened
## Actionable findings

<details><summary>Raw output</summary>...</details>
```

## Files Changed

| Action | Path |
|--------|------|
| Create | `scenario-tests/test-heartbeat-lifecycle.sh` |
| Create | `scenario-tests/test-meditate-create.sh` |
