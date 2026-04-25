---
status: implemented
---

# Meditate `--steer` Flag Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `--steer <text>` flag to `ralph meditate` and `ralph heartbeat meditate` that appends a steering message to the session input sent to Claude.

**Architecture:** Add `message?: string` to `RunOptions` in `agent.ts`; when present, it is appended to the stdin content written to the claude process. Thread `steer?` from Commander through `meditateCommand` → `runMeditationSession` → `agent.run({ message })`. In heartbeat, include `["--steer", steerText]` in the daemon `args` array — the runner replays those verbatim so the scheduled spawn picks them up automatically.

**Tech Stack:** TypeScript, Commander, Node `child_process.spawn` (via `Agent`), vitest

---

## Chunk 1: Extend `Agent.run()` and `runMeditationSession`

### Task 1: Write failing tests for `Agent.run()` `message` option

**Files:**
- Modify: `src/cli/tests/meditate.test.ts`

- [ ] **Step 1: Add `Agent` mock infrastructure at top of test file**

Open `src/cli/tests/meditate.test.ts`. After the existing `vi.mock("../lib/output.js", ...)` block and before the imports from `../commands/meditate`, add a mock for the Agent class:

```typescript
// Capture RunOptions passed to agent.run()
let lastRunOptions: import("../lib/agent.js").RunOptions | undefined;
const mockAgentRun = vi.fn(async (opts: import("../lib/agent.js").RunOptions) => {
  lastRunOptions = opts;
  return { exitCode: 0, sessionId: null, stdout: null };
});

vi.mock("../lib/agent.js", () => ({
  Agent: vi.fn().mockImplementation(() => ({
    run: mockAgentRun,
    kill: vi.fn(),
  })),
  validateAgentConfig: vi.fn((c) => c),
}));

vi.mock("../lib/agent-registry.js", () => ({
  resolveAgent: vi.fn(() => ({
    name: "meditate",
    description: "test",
    model: "opus",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "system prompt",
  })),
}));

vi.mock("../lib/assets.js", () => ({
  getIlluminationServerPath: vi.fn(() => "/fake/server.js"),
  getMetaMeditationsDir: vi.fn(() => "/fake/meditations"),
}));
```

- [ ] **Step 2: Write a `describe("runMeditationSession")` block with two failing tests**

Append after the existing `describe` blocks in the test file:

```typescript
describe("runMeditationSession steer", () => {
  beforeEach(() => {
    lastRunOptions = undefined;
    mockAgentRun.mockClear();
  });

  it("passes message to agent.run() when steer is provided", async () => {
    await runMeditationSession(tmpDir, "focus on auth");
    expect(lastRunOptions?.message).toBe("focus on auth");
  });

  it("does not set message when steer is omitted", async () => {
    await runMeditationSession(tmpDir);
    expect(lastRunOptions?.message).toBeUndefined();
  });
});
```

Also add `runMeditationSession` to the named import at the top of the file:

```typescript
import {
  pidPath,
  writePid,
  readPid,
  removePid,
  isPidAlive,
  ensureMeditationDirs,
  appendMeditateGitignore,
  runMeditationSession,   // ← add this
} from "../commands/meditate";
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npm test -- src/cli/tests/meditate.test.ts`

Expected: the two new `runMeditationSession steer` tests FAIL with "runMeditationSession is not a function" or similar. All existing tests PASS.

---

### Task 2: Implement `message?` in `RunOptions` and `Agent.run()`

**Files:**
- Modify: `src/cli/lib/agent.ts`

- [ ] **Step 1: Add `message?` to `RunOptions`**

Find the `RunOptions` interface (around line 27). Add the new field:

```typescript
export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  variables?: Record<string, unknown>;
  resume?: string;
  interactive?: boolean;
  onSessionId?: (id: string) => void;
  onStdout?: (stdout: NodeJS.ReadableStream) => Promise<void>;
  /** When provided, appended to the system prompt written to stdin. */
  message?: string;
}
```

- [ ] **Step 2: Append `message` to stdin content in `Agent.run()`**

Find the stdin write block (around line 213):

```typescript
if (!isInteractive && !isResume && child.stdin) {
  child.stdin.write(expandedPrompt);
  child.stdin.end();
}
```

Replace with:

```typescript
if (!isInteractive && !isResume && child.stdin) {
  const stdinContent = options.message
    ? `${expandedPrompt}\n\n${options.message}`
    : expandedPrompt;
  child.stdin.write(stdinContent);
  child.stdin.end();
}
```

---

### Task 3: Export `runMeditationSession` and add `steer?` parameter

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [ ] **Step 1: Export `runMeditationSession` and add `steer?` parameter**

Change line 64:

```typescript
// before
async function runMeditationSession(absPath: string): Promise<void> {
// after
export async function runMeditationSession(absPath: string, steer?: string): Promise<void> {
```

- [ ] **Step 2: Pass `steer` as `message` to `agent.run()`**

Find the `agent.run({...})` call (around line 88). Add `message: steer`:

```typescript
const result = await agent.run({
  cwd: absPath,
  variables: {
    ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
    PROJECT_ROOT: absPath,
    META_MEDITATIONS_DIR: getMetaMeditationsDir(),
  },
  message: steer,
  onStdout: async (stdout) => {
    await output.stream(streamEvents(stdout, {}));
  },
});
```

- [ ] **Step 3: Run tests — expect green**

Run: `npm test -- src/cli/tests/meditate.test.ts`

Expected: ALL tests pass including the two new `runMeditationSession steer` tests.

- [ ] **Step 4: Commit Chunk 1**

```bash
git add src/cli/lib/agent.ts src/cli/commands/meditate.ts src/cli/tests/meditate.test.ts
git commit -m "feat(meditate): add message? to RunOptions and steer? to runMeditationSession"
```

---

## Chunk 2: Wire `--steer` into Commander and heartbeat

### Task 4: Write failing tests for `meditateCommand --steer` and heartbeat

**Files:**
- Modify: `src/cli/tests/meditate.test.ts`
- Modify: `src/cli/tests/heartbeat.test.ts`

- [ ] **Step 1: Add `meditateCommand` to meditate test imports**

Add `meditateCommand` to the existing named import from `../commands/meditate`.

- [ ] **Step 2: Write failing tests for `meditateCommand` opts passthrough**

Append to `src/cli/tests/meditate.test.ts`:

```typescript
describe("meditateCommand --steer passthrough", () => {
  beforeEach(() => {
    lastRunOptions = undefined;
    mockAgentRun.mockClear();
  });

  it("passes steer to runMeditationSession when provided", async () => {
    await meditateCommand(tmpDir, { steer: "focus on auth" });
    expect(lastRunOptions?.message).toBe("focus on auth");
  });

  it("does not set message when steer is omitted", async () => {
    await meditateCommand(tmpDir);
    expect(lastRunOptions?.message).toBeUndefined();
  });
});
```

Note: `meditateCommand` calls `spawnSync("which", ["claude"])` — mock it or ensure `claude` is on PATH in CI. The existing test infrastructure may already handle this; if the test fails on the `which` check, add:

```typescript
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 0 })),
  };
});
```

- [ ] **Step 3: Write failing heartbeat steer tests**

Open `src/cli/tests/heartbeat.test.ts`. The file already has `makeProgram()`, `FIXTURE_DIR`, and `vi.mock("../../lib/daemon-client", ...)`. Add a new describe block:

```typescript
describe("heartbeat meditate --steer", () => {
  it("includes --steer in args when provided", async () => {
    (request as ReturnType<typeof vi.fn>).mockResolvedValue({ taskId: "meditate:test" });
    const program = makeProgram();
    await program.parseAsync([
      "node", "ralph",
      "heartbeat", "meditate", FIXTURE_DIR,
      "--every", "30",
      "--steer", "focus on auth",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", expect.objectContaining({
      command: "meditate",
      args: [expect.stringContaining(FIXTURE_DIR.split("/").pop()!), "--steer", "focus on auth"],
    }));
  });

  it("omits --steer from args when not provided", async () => {
    (request as ReturnType<typeof vi.fn>).mockResolvedValue({ taskId: "meditate:test" });
    const program = makeProgram();
    await program.parseAsync([
      "node", "ralph",
      "heartbeat", "meditate", FIXTURE_DIR,
      "--every", "30",
    ]);
    const callArgs = (request as ReturnType<typeof vi.fn>).mock.calls[0][1].args as string[];
    expect(callArgs).not.toContain("--steer");
  });
});
```

- [ ] **Step 4: Run tests to confirm failures**

Run: `npm test -- src/cli/tests/meditate.test.ts src/cli/tests/heartbeat.test.ts`

Expected: new tests FAIL, existing tests PASS.

---

### Task 5: Add `--steer` to Commander and `meditateCommand`

**Files:**
- Modify: `src/cli/commands/meditate.ts`
- Modify: `src/cli/program.ts`

- [ ] **Step 1: Update `meditateCommand` signature**

In `src/cli/commands/meditate.ts`, change line 112:

```typescript
// before
export async function meditateCommand(projectFolder: string): Promise<void> {
// after
export async function meditateCommand(projectFolder: string, opts: { steer?: string } = {}): Promise<void> {
```

Change the `runMeditationSession` call (line 130):

```typescript
// before
await runMeditationSession(absPath);
// after
await runMeditationSession(absPath, opts.steer);
```

- [ ] **Step 2: Add `--steer` option to Commander registration in `program.ts`**

Find this block (around line 117–121):

```typescript
med
  .argument("<project-folder>")
  .action(async (projectFolder: string) => {
    await meditateCommand(projectFolder);
  });
```

Replace with:

```typescript
med
  .argument("<project-folder>")
  .option("--steer <text>", "initial steering message injected as first user turn")
  .action(async (projectFolder: string, opts: { steer?: string }) => {
    await meditateCommand(projectFolder, opts);
  });
```

---

### Task 6: Add `--steer` to heartbeat meditate subcommand

**Files:**
- Modify: `src/cli/commands/heartbeat.ts`

- [ ] **Step 1: Add `--steer` option and update the action**

Find the `hb.command("meditate <folder>")` block (around line 87–110). Make two changes:

**Add `.option(...)` after `.requiredOption(...)`:**

```typescript
.requiredOption("--every <n>", "interval in minutes", (v) => {
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1) throw new Error("--every must be a positive integer");
  return n;
})
.option("--steer <text>", "initial steering message for the session")
```

**Update the action signature and `register_task` call:**

```typescript
.action(async (folder: string, opts: { every: number; steer?: string }) => {
  const absPath = resolve(folder);
  validatePathArg(folder, absPath, "directory", "Project folder");
  try {
    const taskArgs = opts.steer
      ? [absPath, "--steer", opts.steer]
      : [absPath];
    const res = await request("register_task", {
      command: "meditate",
      args: taskArgs,
      interval: opts.every,
    });
    await output.success(`Registered: ${res.taskId} (every ${opts.every} min)`);
  } catch (err: any) {
    await output.error(`Error: ${err.message}`);
    process.exit(1);
  }
});
```

---

### Task 7: Verify all tests pass and commit

- [ ] **Step 1: Run meditate and heartbeat tests**

Run: `npm test -- src/cli/tests/meditate.test.ts src/cli/tests/heartbeat.test.ts`

Expected: ALL tests pass.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all tests pass, no regressions.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/meditate.ts src/cli/program.ts src/cli/commands/heartbeat.ts \
        src/cli/tests/meditate.test.ts src/cli/tests/heartbeat.test.ts
git commit -m "feat(meditate): add --steer flag to meditate and heartbeat meditate"
```
