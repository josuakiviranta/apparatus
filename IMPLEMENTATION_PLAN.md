# Heartbeat: Schedule Any Ralph Command Implementation Plan

> **All 6 chunks COMPLETED.** Tag: 0.0.33. Date: 2026-04-10.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Allow `ralph heartbeat` to schedule any ralph command (`implement`, `run-scenarios`, `pipeline`) — not just `meditate`.

**Architecture:** Three coupling points need fixing: (1) PID tracking in `runner.ts` is meditate-specific — move to daemon-managed `~/.ralph/pids/` files using the child PID directly; (2) task ID generation in `daemon/index.ts` uses `basename(args[0])` which breaks for `pipeline` (where `args[0]` = "run") — fix by accepting an optional `id` from the client; (3) `heartbeat.ts` only exposes `meditate` — add `implement`, `run-scenarios`, and `pipeline` subcommands.

**Tech Stack:** TypeScript, Node.js, Commander.js, Vitest

---

## Chunk 1: Fix PID tracking in runner.ts (meditate-agnostic)

### Files
- Modify: `src/daemon/state.ts`
- Modify: `src/daemon/runner.ts`
- Modify: `src/daemon/tests/runner.test.ts`

### Context

Currently `runner.ts` reads/writes `.meditate.pid` inside the project folder (`task.args[0]`). This assumes the spawned command is always `meditate` and that `args[0]` is always a project folder path. For `implement`, `run-scenarios`, and `pipeline`, this breaks.

**Fix:** The runner writes the child process PID itself to `~/.ralph/pids/<safe-id>.pid` at spawn time, and cleans it up on process close. No spawned command needs to write its own PID file.

Safe ID = `task.id` with all non-alphanumeric chars replaced by `-`, e.g. `implement:my-app` → `implement-my-app`.

### Task 1: Add PID dir helpers to state.ts

**Files:**
- Modify: `src/daemon/state.ts:31-38`

- [x] **Step 1: Add `getPidFilePath` and update `ensureDirs`**

In `state.ts`, add after `getRalphDir()`:

```typescript
export function getPidFilePath(taskId: string): string {
  const safeId = taskId.replace(/[^a-zA-Z0-9]/g, "-");
  return join(getRalphDir(), "pids", `${safeId}.pid`);
}
```

Update `ensureDirs()` to also create `~/.ralph/pids/`:

```typescript
export function ensureDirs(): void {
  mkdirSync(join(getRalphDir(), "logs"), { recursive: true });
  mkdirSync(join(getRalphDir(), "pids"), { recursive: true });
}
```

- [x] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add src/daemon/state.ts
git commit -m "feat(daemon): add getPidFilePath helper and ensure pids dir"
```

---

### Task 2: Rewrite PID logic in runner.ts

**Files:**
- Modify: `src/daemon/runner.ts`

- [x] **Step 1: Write failing tests**

In `src/daemon/tests/runner.test.ts`, add `getPidFilePath` to the existing state imports at the top:

```typescript
import { ensureDirs, readRunLogs, getPidFilePath } from "../state";
```

Then **fully replace** the `isSessionRunning / killSession` describe block (lines 95-104 in the original):

```typescript
describe("isSessionRunning / killSession", () => {
  it("returns false when no pid file", () => {
    expect(isSessionRunning(makeTask())).toBe(false);
  });

  it("returns false when pid file has dead pid", () => {
    writeFileSync(getPidFilePath("meditate:proj"), "99999999");
    expect(isSessionRunning(makeTask())).toBe(false);
  });

  it("runTask writes pid file during execution and cleans up after", async () => {
    const task = makeTask();
    vi.stubEnv(
      "RALPH_TEST_CMD",
      `${process.execPath} -e "setTimeout(() => process.exit(0), 50)"`,
    );
    const runPromise = runTask(task);
    // Give child a moment to spawn
    await new Promise((r) => setTimeout(r, 20));
    // PID file should exist while running
    expect(existsSync(getPidFilePath(task.id))).toBe(true);
    await runPromise;
    // PID file should be gone after exit
    expect(existsSync(getPidFilePath(task.id))).toBe(false);
    vi.unstubAllEnvs();
  });
});
```

- [x] **Step 2: Run tests — expect failures**

```bash
npx vitest run src/daemon/tests/runner.test.ts 2>&1 | tail -20
```

Expected: `runTask writes pid file` fails (no pid file written yet).

- [x] **Step 3: Rewrite runner.ts PID logic**

Remove `getPidPath`, `isSessionRunning`, `killSession` functions. Replace with:

```typescript
import { writeFileSync, unlinkSync } from "fs";
import { getPidFilePath } from "./state";

export function isSessionRunning(task: Task): boolean {
  const pidPath = getPidFilePath(task.id);
  if (!existsSync(pidPath)) return false;
  const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killSession(task: Task): boolean {
  const pidPath = getPidFilePath(task.id);
  if (!existsSync(pidPath)) return false;
  const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (isNaN(pid)) return false;
  try {
    process.kill(pid, "SIGTERM");
    try { unlinkSync(pidPath); } catch {}
    return true;
  } catch {
    return false;
  }
}
```

In `runTask()`, after the `spawn()` call, write the PID file:

```typescript
const child = spawn(cliPath.command, fullArgs, {
  stdio: ["ignore", "pipe", "pipe"],
  env,
  shell: cliPath.shell,
});

// Write PID so isSessionRunning/killSession can check it
const pidPath = getPidFilePath(task.id);
if (child.pid) {
  writeFileSync(pidPath, String(child.pid));
}
```

In the `child.on("close", ...)` handler, clean up the PID file:

```typescript
child.on("close", (code) => {
  // Clean up PID file
  try { unlinkSync(pidPath); } catch {}
  // ... rest of existing close handler
});
```

Also update the imports at the top of `runner.ts`: add `writeFileSync, unlinkSync` to the `fs` import and import `getPidFilePath` from `./state`.

- [x] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/daemon/tests/runner.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [x] **Step 5: Commit**

```bash
git add src/daemon/runner.ts src/daemon/tests/runner.test.ts
git commit -m "feat(daemon): track child PID in ~/.ralph/pids/ — removes meditate-specific PID logic"
```

---

## Chunk 2: Add optional `id` to `register_task` IPC protocol

### Files
- Modify: `src/daemon/socket.ts`
- Modify: `src/daemon/index.ts`

### Context

`daemon/index.ts` generates task IDs as `${command}:${basename(args[0])}`. For `pipeline` commands, `args[0]` = `"run"` (a subcommand), so the ID becomes `pipeline:run` regardless of which dotfile is used — all pipeline tasks would collide.

Fix: the `register_task` IPC message now accepts an optional `id` field. If provided, the daemon uses it directly. The CLI client computes the right ID and passes it.

### Task 3: Accept optional `id` in socket.ts + daemon/index.ts

**Files:**
- Modify: `src/daemon/socket.ts:4-12`
- Modify: `src/daemon/index.ts:72-90`

- [x] **Step 1: Update `RequestHandlers` in socket.ts**

Change the `register_task` handler signature to accept optional `id`:

```typescript
export interface RequestHandlers {
  // ...
  register_task(command: string, args: string[], interval: number, id?: string): Task;
  // ...
}
```

In `handleRequest`, pass `req.id` (may be undefined):

```typescript
case "register_task": {
  const task = handlers.register_task(req.command, req.args, req.interval, req.id);
  send(socket, { type: "ok", taskId: task.id });
  return null;
}
```

- [x] **Step 2: Update `register_task` handler in daemon/index.ts**

```typescript
register_task: (command, args, interval, id) => {
  const computedId = id ?? `${command}:${basename(args[0])}`;
  const existing = getTask(computedId);
  const task: Task = {
    id: computedId,
    command,
    args,
    interval,
    status: "active",
    createdAt: existing?.createdAt ?? Date.now(),
    lastRunAt: existing?.lastRunAt ?? null,
    nextRunAt: Date.now() + interval * 60 * 1000,
  };
  upsertTask(task);
  scheduler.register(task, dispatchTask);
  dispatchTask(task);
  broadcast({ type: "task_update", data: task });
  return task;
},
```

- [x] **Step 3: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [x] **Step 4: Run all daemon tests**

```bash
npx vitest run src/daemon/tests/ 2>&1 | tail -20
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add src/daemon/socket.ts src/daemon/index.ts
git commit -m "feat(daemon): accept optional id in register_task — enables pipeline task IDs"
```

---

## Chunk 3: Add heartbeat subcommands for implement and run-scenarios

### Files
- Modify: `src/cli/commands/heartbeat.ts`
- Modify: `src/cli/tests/heartbeat.test.ts`

### Context

Both `implement` and `run-scenarios` take a single `<folder>` arg. Their heartbeat subcommands look identical to `meditate`. Task ID: `${command}:${basename(folder)}`.

### Task 4: Add `implement` and `run-scenarios` subcommands

**Files:**
- Modify: `src/cli/commands/heartbeat.ts`

- [x] **Step 1: Write failing tests**

In `src/cli/tests/heartbeat.test.ts`, add after the `heartbeat meditate` describe block:

```typescript
describe("ralph heartbeat implement", () => {
  it("sends register_task with correct args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "implement:proj" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "implement", "/path/proj", "--every", "10",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      command: "implement",
      args: [expect.stringContaining("proj")],
      interval: 10,
    });
    logSpy.mockRestore();
  });

  it("errors when --every is missing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      makeProgram().parseAsync(["node", "ralph", "heartbeat", "implement", "/path/proj"])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });
});

describe("ralph heartbeat run-scenarios", () => {
  it("sends register_task with correct args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "run-scenarios:proj" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "run-scenarios", "/path/proj", "--every", "60",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      command: "run-scenarios",
      args: [expect.stringContaining("proj")],
      interval: 60,
    });
    logSpy.mockRestore();
  });
});
```

- [x] **Step 2: Run tests — expect failures**

```bash
npx vitest run src/cli/tests/heartbeat.test.ts 2>&1 | tail -20
```

Expected: `implement` and `run-scenarios` tests fail (commands not registered yet).

- [x] **Step 3: Add implement subcommand in heartbeat.ts**

After the `meditate` subcommand block, add:

```typescript
hb
  .command("implement <folder>")
  .description("Schedule the agentic build loop to run on a project folder at a fixed interval")
  .addHelpText("after", "\nExamples:\n  ralph heartbeat implement my-app --every 60\n")
  .requiredOption("--every <n>", "interval in minutes", (v) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1) throw new Error("--every must be a positive integer");
    return n;
  })
  .action(async (folder: string, opts: { every: number }) => {
    const absPath = resolve(folder);
    try {
      const res = await request("register_task", {
        command: "implement",
        args: [absPath],
        interval: opts.every,
      });
      await output.success(`Registered: ${res.taskId} (every ${opts.every} min)`);
    } catch (err: any) {
      await output.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

- [x] **Step 4: Add run-scenarios subcommand in heartbeat.ts**

```typescript
hb
  .command("run-scenarios <folder>")
  .description("Schedule scenario tests to run on a project folder at a fixed interval")
  .addHelpText("after", "\nExamples:\n  ralph heartbeat run-scenarios my-app --every 120\n")
  .requiredOption("--every <n>", "interval in minutes", (v) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1) throw new Error("--every must be a positive integer");
    return n;
  })
  .action(async (folder: string, opts: { every: number }) => {
    const absPath = resolve(folder);
    try {
      const res = await request("register_task", {
        command: "run-scenarios",
        args: [absPath],
        interval: opts.every,
      });
      await output.success(`Registered: ${res.taskId} (every ${opts.every} min)`);
    } catch (err: any) {
      await output.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

- [x] **Step 5: Run tests — expect pass**

```bash
npx vitest run src/cli/tests/heartbeat.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [x] **Step 6: Commit**

```bash
git add src/cli/commands/heartbeat.ts src/cli/tests/heartbeat.test.ts
git commit -m "feat(heartbeat): add implement and run-scenarios scheduling subcommands"
```

---

## Chunk 4: Add heartbeat pipeline subcommand

### Files
- Modify: `src/cli/commands/heartbeat.ts`
- Modify: `src/cli/tests/heartbeat.test.ts`

### Context

`pipeline` is different: it takes a `<dotfile>` and an optional `--project <folder>`. The daemon args become `["run", absDotFile, "--project", absFolder]` so that `runner.ts` spawns `ralph pipeline run <dotfile> --project <folder>`.

The task ID must be computed by the client as `pipeline:<dotfile-stem>` (e.g. `pipeline:smoke` for `smoke.dot`) and passed as `id` in the `register_task` payload. Without this, the daemon would generate `pipeline:run` for all pipeline tasks.

### Task 5: Add pipeline subcommand

**Files:**
- Modify: `src/cli/commands/heartbeat.ts`
- Modify: `src/cli/tests/heartbeat.test.ts`

- [x] **Step 1: Write failing tests**

In `src/cli/tests/heartbeat.test.ts`, add:

```typescript
describe("ralph heartbeat pipeline", () => {
  it("sends register_task with run subcommand args and computed id", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "pipeline", "smoke.dot",
      "--project", "/path/my-app", "--every", "30",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      id: "pipeline:smoke",
      command: "pipeline",
      args: ["run", expect.stringContaining("smoke.dot"), "--project", expect.stringContaining("my-app")],
      interval: 30,
    });
    logSpy.mockRestore();
  });

  it("errors when --every is missing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "pipeline", "smoke.dot",
        "--project", "/path/my-app",
      ])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });

  it("works without --project (pipeline handles default)", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "pipeline", "smoke.dot", "--every", "30",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", expect.objectContaining({
      command: "pipeline",
      id: "pipeline:smoke",
    }));
    logSpy.mockRestore();
  });
});
```

- [x] **Step 2: Run tests — expect failures**

```bash
npx vitest run src/cli/tests/heartbeat.test.ts 2>&1 | tail -20
```

Expected: all 3 `pipeline` tests fail.

- [x] **Step 3: Add imports needed**

At the top of `heartbeat.ts`, ensure `basename` is imported:

```typescript
import { resolve, basename } from "path";
```

- [x] **Step 4: Add pipeline subcommand in heartbeat.ts**

```typescript
hb
  .command("pipeline <dotfile>")
  .description("Schedule a DOT-graph pipeline to run at a fixed interval")
  .addHelpText("after", "\nExamples:\n  ralph heartbeat pipeline workflow.dot --project my-app --every 60\n")
  .option("--project <folder>", "project folder passed to the pipeline")
  .requiredOption("--every <n>", "interval in minutes", (v) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1) throw new Error("--every must be a positive integer");
    return n;
  })
  .action(async (dotfile: string, opts: { project?: string; every: number }) => {
    const absDotFile = resolve(dotfile);
    const stem = basename(absDotFile).replace(/\.dot$/i, "");
    const id = `pipeline:${stem}`;
    const args: string[] = ["run", absDotFile];
    if (opts.project) {
      args.push("--project", resolve(opts.project));
    }
    try {
      const res = await request("register_task", {
        id,
        command: "pipeline",
        args,
        interval: opts.every,
      });
      await output.success(`Registered: ${res.taskId} (every ${opts.every} min)`);
    } catch (err: any) {
      await output.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

- [x] **Step 5: Run tests — expect pass**

```bash
npx vitest run src/cli/tests/heartbeat.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [x] **Step 6: Run full test suite**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [x] **Step 7: Commit**

```bash
git add src/cli/commands/heartbeat.ts src/cli/tests/heartbeat.test.ts
git commit -m "feat(heartbeat): add pipeline scheduling subcommand with explicit task ID"
```

---

## Chunk 5: Update help text and bump version

### Files
- Modify: `src/cli/program.ts`
- Modify: `package.json`

### Task 6: Update global help text

The `--help` output's "Background scheduling (heartbeat)" section lists only `meditate`. Update it to show all four commands.

- [x] **Step 1: Find heartbeat help text in program.ts**

```bash
grep -n "heartbeat" src/cli/program.ts
```

- [x] **Step 2: Update the heartbeat examples block**

Locate the heartbeat examples in the `addHelpText("after", ...)` call and replace the meditate-only examples with:

```
Background scheduling (heartbeat):
  ralph heartbeat meditate my-app --every 30            Run meditate on my-app every 30 min
  ralph heartbeat implement my-app --every 60           Run implement on my-app every 60 min
  ralph heartbeat run-scenarios my-app --every 120      Run scenario tests every 2 hours
  ralph heartbeat pipeline workflow.dot --project my-app --every 60   Run a pipeline every 60 min
  ralph heartbeat list                                  Show all scheduled tasks
  ralph heartbeat logs meditate:my-app --follow         Stream live logs for a task
  ralph heartbeat watch                                 Live TUI dashboard
  ralph heartbeat pause meditate:my-app                 Suspend scheduling without removing
  ralph heartbeat resume meditate:my-app                Re-enable a paused task
  ralph heartbeat stop meditate:my-app                  Remove task and kill any running session
```

- [x] **Step 3: Bump version in package.json**

Check the current version and increment the patch number by 1.

- [x] **Step 4: Build and verify help output**

```bash
npm run build && node dist/cli/index.js --help 2>&1 | grep -A 15 "heartbeat"
```

Expected: updated heartbeat section visible.

- [x] **Step 5: Run full test suite one final time**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [x] **Step 6: Commit**

```bash
git add src/cli/program.ts package.json
git commit -m "feat(heartbeat): update help text and bump version — any ralph command now schedulable"
```

---

## Chunk 6: Scenario tests

### Files
- Create: `scenario-tests/test-heartbeat-any-command.sh`

### Context

Existing scenario tests are bash scripts in `scenario-tests/`. They run against the built CLI (`dist/cli/index.js`), use `mktemp -d` for temp project dirs, and clean up with `trap`. The existing `test-heartbeat-lifecycle.sh` covers `meditate` register/list/pause/resume/logs/stop.

New script tests the three new subcommands. It does **not** wait for actual claude sessions to run (that would be slow and require live credentials). Instead it registers tasks with a very high interval (e.g. 9999 min), verifies the task ID is correct in `heartbeat list`, then stops each task. This proves the registration, ID generation, and cleanup paths all work end-to-end via the daemon.

For `pipeline`, the critical assertion is that the task ID is `pipeline:smoke` (not `pipeline:run`).

### Task 7: Write the scenario test script

**Files:**
- Create: `scenario-tests/test-heartbeat-any-command.sh`

- [x] **Step 1: Build the project**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [x] **Step 2: Write the scenario script**

Create `scenario-tests/test-heartbeat-any-command.sh`:

```bash
#!/usr/bin/env bash
# @name: Heartbeat Any Command
# @description: Verifies that heartbeat can register implement, run-scenarios, and pipeline
#               tasks — checks correct task IDs and full lifecycle (register/list/stop).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RALPH="node $REPO_ROOT/dist/cli/index.js"
TMP_PROJECT="$(mktemp -d)"
PROJ_NAME="$(basename "$TMP_PROJECT")"
ATTRACTOR_DIR="$REPO_ROOT/scenario-tests/attractor"

IMPLEMENT_ID="implement:$PROJ_NAME"
SCENARIOS_ID="run-scenarios:$PROJ_NAME"
PIPELINE_ID="pipeline:smoke"

cleanup() {
  $RALPH heartbeat stop "$IMPLEMENT_ID"  2>/dev/null || true
  $RALPH heartbeat stop "$SCENARIOS_ID" 2>/dev/null || true
  $RALPH heartbeat stop "$PIPELINE_ID"  2>/dev/null || true
  rm -rf "$TMP_PROJECT"
}
trap cleanup EXIT

echo "=== Scenario: Heartbeat Any Command ==="
echo "TMP_PROJECT=$TMP_PROJECT"
echo ""

# ── implement ──────────────────────────────────────────────────────────────────
echo "--- Step 1: Register heartbeat implement ---"
$RALPH heartbeat implement "$TMP_PROJECT" --every 9999

echo ""
echo "--- Step 2: List tasks — expect implement:$PROJ_NAME ---"
OUTPUT=$($RALPH heartbeat list)
echo "$OUTPUT"
echo "$OUTPUT" | grep -q "$IMPLEMENT_ID" || { echo "FAIL: $IMPLEMENT_ID not found in list"; exit 1; }

echo ""
echo "--- Step 3: Stop implement task ---"
$RALPH heartbeat stop "$IMPLEMENT_ID"

echo ""
echo "--- Step 4: Verify implement task removed ---"
$RALPH heartbeat list | grep -vq "$IMPLEMENT_ID" || { echo "FAIL: $IMPLEMENT_ID still listed after stop"; exit 1; }

# ── run-scenarios ──────────────────────────────────────────────────────────────
echo ""
echo "--- Step 5: Register heartbeat run-scenarios ---"
$RALPH heartbeat run-scenarios "$TMP_PROJECT" --every 9999

echo ""
echo "--- Step 6: List tasks — expect run-scenarios:$PROJ_NAME ---"
OUTPUT=$($RALPH heartbeat list)
echo "$OUTPUT"
echo "$OUTPUT" | grep -q "$SCENARIOS_ID" || { echo "FAIL: $SCENARIOS_ID not found in list"; exit 1; }

echo ""
echo "--- Step 7: Stop run-scenarios task ---"
$RALPH heartbeat stop "$SCENARIOS_ID"

# ── pipeline ───────────────────────────────────────────────────────────────────
echo ""
echo "--- Step 8: Register heartbeat pipeline (smoke.dot) ---"
$RALPH heartbeat pipeline "$ATTRACTOR_DIR/smoke.dot" --project "$TMP_PROJECT" --every 9999

echo ""
echo "--- Step 9: List tasks — expect pipeline:smoke (NOT pipeline:run) ---"
OUTPUT=$($RALPH heartbeat list)
echo "$OUTPUT"
echo "$OUTPUT" | grep -q "$PIPELINE_ID"    || { echo "FAIL: $PIPELINE_ID not found in list"; exit 1; }
echo "$OUTPUT" | grep -vq "pipeline:run"   || { echo "FAIL: pipeline:run found — ID generation broken"; exit 1; }

echo ""
echo "--- Step 10: Pause and resume pipeline task ---"
$RALPH heartbeat pause "$PIPELINE_ID"
$RALPH heartbeat list | grep -q "paused" || { echo "FAIL: task not paused"; exit 1; }
$RALPH heartbeat resume "$PIPELINE_ID"

echo ""
echo "--- Step 11: Stop pipeline task ---"
$RALPH heartbeat stop "$PIPELINE_ID"

echo ""
echo "=== DONE — all assertions passed ==="
```

- [x] **Step 3: Make executable**

```bash
chmod +x scenario-tests/test-heartbeat-any-command.sh
```

- [x] **Step 4: Run the scenario test**

```bash
bash scenario-tests/test-heartbeat-any-command.sh
```

Expected: all steps print without `FAIL`, exits 0.

- [x] **Step 5: Commit**

```bash
git add scenario-tests/test-heartbeat-any-command.sh
git commit -m "test(scenario): add heartbeat any-command scenario test"
```
