# Scenario Test Bugfixes Implementation Plan

**Status:** COMPLETED

**Goal:** Fix two bugs exposed by `ralph run-scenarios`: (1) pipeline TTY crash on `wait.human` nodes in non-interactive contexts, (2) heartbeat task reappearing after stop due to async race condition.

**Architecture:** Bug 1 is a one-line caller fix — auto-detect TTY before choosing interviewer. Bug 2 is a small in-memory guard — track deleted task IDs and skip stale async callbacks.

**Tech Stack:** TypeScript, vitest

---

## Chunk 1: Pipeline TTY auto-detection — DONE

- [x] Added `AutoApproveInterviewer` import to `src/cli/commands/pipeline.ts`
- [x] Changed interviewer selection to `process.stdin.isTTY ? new ConsoleInterviewer() : new AutoApproveInterviewer()`
- [x] Added test "uses AutoApproveInterviewer when stdin is not a TTY" in `src/cli/tests/pipeline.test.ts`

**Why:** In non-interactive contexts (CI, piped stdin, heartbeat), `ConsoleInterviewer` crashes because it tries to read from a TTY that doesn't exist. Auto-detecting TTY ensures pipelines with `wait.human` gates auto-approve in non-interactive mode.

## Chunk 2: Heartbeat race condition guard — DONE

- [x] Added `deletedTasks` Set in `src/daemon/index.ts`
- [x] Guarded `.then()` callback in `dispatchTask` with `if (deletedTasks.has(task.id)) return;`
- [x] Added `deletedTasks.add(taskId)` in `stop_task` handler before `deleteTask()`
- [x] Added `deletedTasks.delete(taskId)` in `register_task` handler for re-registration
- [x] Added documenting test "upsertTask re-inserts a deleted task" in `src/daemon/tests/state.test.ts`

**Why:** When `stop_task` deletes a task while `runTask()` is still in-flight, the `.then()` callback calls `upsertTask()` after deletion, causing the task to reappear. The `deletedTasks` guard prevents stale callbacks from resurrecting stopped tasks.

## Chunk 3: Verification — DONE

- [x] All 410 tests pass
- [x] TypeScript typecheck clean
- [x] Build succeeds
