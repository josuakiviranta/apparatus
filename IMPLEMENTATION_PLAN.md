# Scenario Tests for ralph Commands Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two scenario test scripts that cover the `heartbeat` subcommand lifecycle and `ralph meditate create`, exercising each path end-to-end with no lingering background processes.

**Architecture:** Two shell scripts in `scenario-tests/` following the existing `@name`/`@description` header convention. The heartbeat script runs real daemon commands in sequence with a `trap` cleanup guarantee. The meditate-create script delegates to vitest, matching the existing `test-meditate-session.sh` pattern.

**Tech Stack:** bash, Node.js (`dist/cli/index.js`), vitest, ralph daemon

---

## Chunk 1: Heartbeat Lifecycle Script

**Spec:** `docs/superpowers/specs/2026-04-07-scenario-tests-commands-design.md`

### Task 1: Create `test-heartbeat-lifecycle.sh`

**Files:**
- Create: `scenario-tests/test-heartbeat-lifecycle.sh`

**Context:** The heartbeat task ID format is `meditate:<basename-of-abs-path>` — the daemon constructs it as `${command}:${basename(args[0])}` (see `src/daemon/index.ts`). So for a temp dir `/tmp/tmp.XyZ123`, the task ID is `meditate:tmp.XyZ123`. The `logs` subcommand without `--follow` does a single request and prints the raw response; there may be no log content yet since the interval is 60 min and the task hasn't fired. The `|| true` on the logs step handles this gracefully.

The dist CLI is at `$REPO_ROOT/dist/cli/index.js` — use `node "$REPO_ROOT/dist/cli/index.js"` consistently (same pattern as `test-run-scenarios.sh`).

The `trap cleanup EXIT` fires after the explicit Step 6 stop, so `cleanup` will attempt a second `heartbeat stop` on an already-removed task. The `|| true` suppresses any error — this double-stop is intentional and safe.

- [ ] **Step 1: Create the script**

Create `scenario-tests/test-heartbeat-lifecycle.sh` with this content:

```bash
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
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scenario-tests/test-heartbeat-lifecycle.sh
```

- [ ] **Step 3: Build dist if needed**

```bash
ls dist/cli/index.js 2>/dev/null || npm run build
```

- [ ] **Step 4: Run the script directly to verify it works**

```bash
bash scenario-tests/test-heartbeat-lifecycle.sh
```

Expected: prints each step header, each subcommand output (e.g. `Registered: meditate:/tmp/...`, `Paused: meditate:/tmp/...`, `Stopped and removed: meditate:/tmp/...`), final list shows "No heartbeat tasks registered." Exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scenario-tests/test-heartbeat-lifecycle.sh
git commit -m "feat: add heartbeat lifecycle scenario test"
```

---

## Chunk 2: Meditate Create Script

### Task 2: Create `test-meditate-create.sh`

**Files:**
- Create: `scenario-tests/test-meditate-create.sh`
- Reference: `src/cli/tests/meditate-create.test.ts` (existing vitest file being delegated to)

**Context:** `ralph meditate create` is a two-phase interactive command (non-interactive Claude kickoff → TUI resume). It cannot be run end-to-end in a script without spawning real Claude. The vitest test file exercises `buildMeditateCreateKickoffArgs` and related pure functions with stubs. This script follows the identical pattern to `test-meditate-session.sh`.

- [ ] **Step 1: Check what the meditate-create vitest file covers**

```bash
npx vitest run src/cli/tests/meditate-create.test.ts --reporter=verbose 2>&1 | head -40
```

Expected: tests pass. Note which test names appear — the script description should match what's actually tested.

- [ ] **Step 2: Create the script**

Create `scenario-tests/test-meditate-create.sh` with this content:

```bash
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
```

- [ ] **Step 3: Make executable**

```bash
chmod +x scenario-tests/test-meditate-create.sh
```

- [ ] **Step 4: Run the script directly to verify**

```bash
bash scenario-tests/test-meditate-create.sh
```

Expected: vitest output with all tests passing. Exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scenario-tests/test-meditate-create.sh
git commit -m "feat: add meditate create scenario test"
```

---

## Chunk 3: End-to-End Verification

### Task 3: Verify both scenarios run via `ralph run-scenarios`

**Files:**
- No new files — this task just verifies the full pipeline works.

**Context:** `ralph run-scenarios` discovers `scenario-tests/*.sh` files, builds a Claude prompt from the `@name`/`@description` headers, spawns a Claude session per scenario, and writes a report to `scenario-runs/`. Use `--all` to skip interactive selection.

- [ ] **Step 1: Confirm dist is current**

```bash
npm run build
```

- [ ] **Step 2: Run both new scenarios via `ralph run-scenarios`**

```bash
node dist/cli/index.js run-scenarios . --all 2>&1
```

Expected: both new scenarios appear in the list, Claude sessions run for each, two new `.md` files appear in `scenario-runs/` with `status: pass`.

- [ ] **Step 3: Verify no background daemon tasks linger**

```bash
node dist/cli/index.js heartbeat list
```

Expected: "No heartbeat tasks registered." (or only pre-existing tasks, none from the test run).

- [ ] **Step 4: Commit scenario-runs reports (optional)**

If the reports are worth keeping:

```bash
git add scenario-runs/
git commit -m "chore: add initial scenario run reports for heartbeat and meditate-create"
```
