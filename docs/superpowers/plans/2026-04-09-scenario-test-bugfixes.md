# Scenario Test Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs exposed by `ralph run-scenarios`: (1) pipeline TTY crash on `wait.human` nodes in non-interactive contexts, (2) heartbeat task reappearing after stop due to async race condition.

**Architecture:** Bug 1 is a one-line caller fix — auto-detect TTY before choosing interviewer. Bug 2 is a small in-memory guard — track deleted task IDs and skip stale async callbacks.

**Tech Stack:** TypeScript, vitest

---

## Chunk 1: Pipeline TTY auto-detection

### Task 1: Add unit test for non-TTY interviewer selection

**Files:**
- Modify: `src/cli/tests/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new test inside the existing `pipelineRunCommand` describe block that verifies `runPipeline` receives an `AutoApproveInterviewer` when `process.stdin.isTTY` is falsy.

```typescript
it("uses AutoApproveInterviewer when stdin is not a TTY", async () => {
  const originalIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
  try {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { logsRoot: dir });
    const call = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[1];
    expect(opts.interviewer.constructor.name).toBe("AutoApproveInterviewer");
  } finally {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline.test.ts -t "uses AutoApproveInterviewer" --reporter=verbose`

Expected: FAIL — currently always passes `ConsoleInterviewer`.

### Task 2: Fix interviewer selection in pipeline.ts

**Files:**
- Modify: `src/cli/commands/pipeline.ts:1-7,87`

- [ ] **Step 3: Add AutoApproveInterviewer import**

At line 7 of `src/cli/commands/pipeline.ts`, add:

```typescript
import { AutoApproveInterviewer } from "../../attractor/interviewer/auto-approve.js";
```

- [ ] **Step 4: Replace hardcoded ConsoleInterviewer with TTY detection**

Change line 87 from:

```typescript
      interviewer: new ConsoleInterviewer(),
```

to:

```typescript
      interviewer: process.stdin.isTTY ? new ConsoleInterviewer() : new AutoApproveInterviewer(),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/pipeline.test.ts --reporter=verbose`

Expected: ALL PASS including the new test.

- [ ] **Step 6: Run the gate_test scenario to verify end-to-end**

Run: `npx vitest run src/cli/tests/pipeline.test.ts --reporter=verbose && npm run build`

Then manually verify: `node dist/cli/index.js pipeline run scenario-tests/attractor/gate_test.dot`

Expected: Pipeline completes (auto-approves "Yes" path), no TTY crash.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/pipeline.ts src/cli/tests/pipeline.test.ts
git commit -m "fix: auto-detect TTY for pipeline interviewer selection"
```

---

## Chunk 2: Heartbeat race condition guard

### Task 3: Add regression test for stop-then-upsert race

**Files:**
- Modify: `src/daemon/tests/state.test.ts`

This test validates the symptom at the state layer: if `upsertTask` is called after `deleteTask` for the same ID, the task reappears. This isn't wrong behavior in `state.ts` itself — the bug is in the caller — but the test documents the scenario for clarity.

- [ ] **Step 1: Write the documenting test**

Add inside the `task CRUD` describe block:

```typescript
it("upsertTask re-inserts a deleted task (documents race condition vector)", () => {
  const task = makeTask();
  upsertTask(task);
  deleteTask(task.id);
  expect(readTasks()).toHaveLength(0);
  // This is the race: a stale .then() callback calls upsertTask after delete
  upsertTask({ ...task, lastRunAt: Date.now() });
  expect(readTasks()).toHaveLength(1); // task is back — this is the bug vector
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/daemon/tests/state.test.ts --reporter=verbose`

Expected: PASS — this documents existing behavior, not a fix.

### Task 4: Add the deletedTasks guard in daemon/index.ts

**Files:**
- Modify: `src/daemon/index.ts:32,51-54,72-73,92-97`

- [ ] **Step 3: Add deletedTasks Set**

After line 35 (`const watchListeners = new Set<...>()`), add:

```typescript
const deletedTasks = new Set<string>();
```

- [ ] **Step 4: Guard the .then() callback in dispatchTask**

Change lines 51-54 from:

```typescript
  runTask(task).then(({ exitCode }) => {
    const finished: Task = { ...updated, lastRunAt: Date.now() };
    upsertTask(finished);
    broadcast({ type: "task_update", data: finished });
```

to:

```typescript
  runTask(task).then(({ exitCode }) => {
    if (deletedTasks.has(task.id)) return;
    const finished: Task = { ...updated, lastRunAt: Date.now() };
    upsertTask(finished);
    broadcast({ type: "task_update", data: finished });
```

- [ ] **Step 5: Track deletion in stop_task**

Change the `stop_task` handler (lines 92-99) from:

```typescript
  stop_task: (taskId) => {
    const task = getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}. Run 'ralph heartbeat list' to see active tasks.`);
    scheduler.unregister(taskId);
    if (isSessionRunning(task)) killSession(task);
    deleteTask(taskId);
    broadcast({ type: "task_update", data: { ...task, status: "stopped" } });
  },
```

to:

```typescript
  stop_task: (taskId) => {
    const task = getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}. Run 'ralph heartbeat list' to see active tasks.`);
    scheduler.unregister(taskId);
    if (isSessionRunning(task)) killSession(task);
    deletedTasks.add(taskId);
    deleteTask(taskId);
    broadcast({ type: "task_update", data: { ...task, status: "stopped" } });
  },
```

- [ ] **Step 6: Clear deletedTasks on re-registration**

Change the `register_task` handler (line 72-73) from:

```typescript
  register_task: (command, args, interval, id) => {
    const taskId = id ?? `${command}:${basename(args[0])}`;
```

to:

```typescript
  register_task: (command, args, interval, id) => {
    const taskId = id ?? `${command}:${basename(args[0])}`;
    deletedTasks.delete(taskId);
```

- [ ] **Step 7: Run all daemon tests**

Run: `npx vitest run src/daemon/tests/ --reporter=verbose`

Expected: ALL PASS.

- [ ] **Step 8: Build and run heartbeat lifecycle scenario**

Run: `npm run build`

Then verify the scenario test passes (task should NOT reappear after stop):

```bash
bash scenario-tests/test-heartbeat-lifecycle.sh
```

Expected: Step 7 ("Verify task removed") shows empty list.

- [ ] **Step 9: Commit**

```bash
git add src/daemon/index.ts src/daemon/tests/state.test.ts
git commit -m "fix: guard against stale upsertTask after stop in daemon"
```

---

## Chunk 3: Full scenario suite verification

### Task 5: Run all scenario tests

- [ ] **Step 1: Build**

Run: `npm run build`

- [ ] **Step 2: Run full scenario suite**

Run all 9 scenario tests and verify no regressions:

```bash
ralph run-scenarios ralph-cli
```

Select `all`.

Expected:
- `gate_test` now passes (was failing)
- `heartbeat-lifecycle` Step 7 shows empty list (was showing stale task)
- All other tests remain passing (8/9 were already passing)

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: verify all scenario tests pass after bugfixes"
```
