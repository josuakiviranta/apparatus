# Unified Command Output Implementation Plan

> **COMPLETED** -- All tasks finished and verified. 259 tests pass, build succeeds. Tagged 0.0.29.
> Completed 2026-04-08.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all non-interactive Claude command output through stream-formatter and output.ts, replacing raw stdout writes in `plan`, `new`, and `meditate-create` commands.

**Architecture:** Add `streamEvents(readable, opts?)` to `stream-formatter.ts` — a single async generator wrapping the readline loop. Replace per-command manual parsing functions with `output.header()` + `output.stream(streamEvents(child.stdout))`. Session ID is captured via `onSessionId` callback; trace path is emitted as `output.info()` after stream completes (before interactive TUI handoff) to avoid concurrent Ink renders.

**Tech Stack:** TypeScript, Node.js streams, readline, vitest, Ink (via output.ts)

**Spec:** `docs/superpowers/specs/2026-04-08-unified-command-output-design.md`

---

## Chunk 1: Add `streamEvents()` to stream-formatter.ts

### Task 1: Write failing tests for `streamEvents`

**Files:**
- Modify: `src/cli/tests/stream-formatter.test.ts`

- [x] **Step 1: Update imports at top of stream-formatter.test.ts**

Replace the existing two import lines (vitest + stream-formatter) with:

```ts
import { describe, it, expect } from "vitest";
import { Readable } from "stream";
import { processLine, initialState, flushState, streamEvents, type FormatterState, type StreamEvent } from "../lib/stream-formatter";
```

Add this helper after the existing `eventsToText` function:

```ts
function makeReadable(lines: string[]): NodeJS.ReadableStream {
  const r = new Readable({ read() {} });
  for (const line of lines) r.push(line + "\n");
  r.push(null);
  return r;
}
```

- [x] **Step 2: Add `describe("streamEvents", ...)` block at the end of the file**

```ts
describe("streamEvents", () => {
  it("yields StreamEvents produced by processLine for each line", async () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello" }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const events: StreamEvent[] = [];
    for await (const e of streamEvents(makeReadable([line]))) {
      events.push(e);
    }
    expect(events.some(e => e.type === "main_agent_open")).toBe(true);
    expect(events.some(e => e.type === "text" && (e as any).content === "Hello")).toBe(true);
  });

  it("flushes remaining state at end of stream (emits main_agent_close)", async () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hi" }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const events: StreamEvent[] = [];
    for await (const e of streamEvents(makeReadable([line]))) {
      events.push(e);
    }
    expect(events.some(e => e.type === "main_agent_close")).toBe(true);
  });

  it("calls onSessionId with session_id from first matching event", async () => {
    const lines = [
      JSON.stringify({ type: "system", session_id: "abc-123" }),
      JSON.stringify({ type: "system", session_id: "should-not-appear" }),
    ];
    const captured: string[] = [];
    for await (const _ of streamEvents(makeReadable(lines), { onSessionId: id => captured.push(id) })) {
      // consume
    }
    expect(captured).toEqual(["abc-123"]);
  });

  it("works without opts (no onSessionId)", async () => {
    const line = JSON.stringify({ type: "system", session_id: "xyz" });
    const events: StreamEvent[] = [];
    for await (const e of streamEvents(makeReadable([line]))) {
      events.push(e);
    }
    // system events produce no StreamEvents — just verifying no crash
    expect(events).toEqual([]);
  });
});
```

- [x] **Step 3: Run the new tests to confirm they fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/stream-formatter.test.ts 2>&1 | tail -20
```

Expected: 4 new tests fail with "streamEvents is not a function" or similar.

---

### Task 2: Implement `streamEvents` in stream-formatter.ts

**Files:**
- Modify: `src/cli/lib/stream-formatter.ts`

- [x] **Step 1: Add `streamEvents` export after `flushState`**

Insert after the closing brace of `flushState` (after line 67), before the `type Usage` declaration:

```ts
export async function* streamEvents(
  readable: NodeJS.ReadableStream,
  opts?: { onSessionId?: (id: string) => void }
): AsyncGenerator<StreamEvent> {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let state = initialState();
  let sessionIdEmitted = false;

  for await (const line of rl) {
    if (!sessionIdEmitted && opts?.onSessionId) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed.session_id === "string") {
          opts.onSessionId(parsed.session_id);
          sessionIdEmitted = true;
        }
      } catch {}
    }
    const { events, nextState } = processLine(line, state);
    state = nextState;
    for (const e of events) yield e;
  }

  for (const e of flushState(state)) yield e;
}
```

- [x] **Step 2: Run the new tests to confirm they pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/stream-formatter.test.ts 2>&1 | tail -20
```

Expected: all tests pass (existing + 4 new).

- [x] **Step 3: Run full test suite to confirm nothing broken**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [x] **Step 4: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/lib/stream-formatter.ts src/cli/tests/stream-formatter.test.ts && git commit -m "$(cat <<'EOF'
feat: add streamEvents() generator to stream-formatter

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 2: Update `loop.ts` to use `streamEvents`

### Task 3: Update loop.test.ts and loop.ts

**Files:**
- Modify: `src/cli/tests/loop.test.ts`
- Modify: `src/cli/lib/loop.ts`

- [x] **Step 1: Add `streamEvents` to the stream-formatter mock in loop.test.ts**

Find the `vi.mock("../lib/stream-formatter.js", ...)` block (lines 34-47). Add `streamEvents` to it:

```ts
vi.mock("../lib/stream-formatter.js", () => ({
  processLine: vi.fn(() => ({
    events: [],
    nextState: { pendingSubagentIds: new Set(), subagentBuffers: new Map(), subagentDescriptions: new Map(), mainAgentOpen: false, lastMainCtxTotal: 0 },
  })),
  initialState: vi.fn(() => ({
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainAgentOpen: false,
    lastMainCtxTotal: 0,
  })),
  flushState: vi.fn(() => []),
  streamEvents: vi.fn(async function* () { /* yields nothing */ }),
}));
```

- [x] **Step 2: Update the `formatter.streamEvents` import alias in loop.test.ts**

The existing import line is:
```ts
import * as formatter from "../lib/stream-formatter.js";
```
This already covers `streamEvents` — no change needed.

- [x] **Step 3: Update the "calls processLine for each line" test**

Find the test named `"calls processLine for each line and passes generator to output.stream()"` (around line 140). Replace it with:

```ts
it("calls streamEvents with child.stdout and passes result to output.stream()", async () => {
  makeMockChild(0);
  mockGitBranch("main");

  await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });

  expect(formatter.streamEvents).toHaveBeenCalledWith(expect.any(Object));
  expect(out.stream).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 4: Run loop tests to confirm the updated test now fails**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/loop.test.ts 2>&1 | tail -20
```

Expected: the updated test fails because `loop.ts` still uses the old inline `sessionStream()`.

- [x] **Step 5: Update `loop.ts` to use `streamEvents`**

At the top of `loop.ts`, change the import from stream-formatter:

```ts
// Before:
import { processLine, initialState, flushState } from "./stream-formatter.js";
import type { StreamEvent } from "./stream-formatter.js";

// After:
import { streamEvents } from "./stream-formatter.js";
import type { StreamEvent } from "./stream-formatter.js";
```

Remove the `readline` import (line 3: `import readline from "readline";`) — it's no longer used directly in loop.ts.

Replace the `sessionStream` inner function and its call (lines 94-113 in current file):

```ts
// Remove this entire block:
async function* sessionStream(): AsyncGenerator<StreamEvent> {
  const readStream = createReadStream(promptFile);
  readStream.pipe(child.stdin as NodeJS.WritableStream);

  const rl = readline.createInterface({
    input: child.stdout as NodeJS.ReadableStream,
    crlfDelay: Infinity,
  });

  let state = initialState();
  for await (const line of rl) {
    const { events, nextState } = processLine(line, state);
    state = nextState;
    for (const e of events) yield e;
  }

  for (const e of flushState(state)) yield e;
}

await output.stream(sessionStream());

// Replace with:
const readStream = createReadStream(promptFile);
readStream.pipe(child.stdin as NodeJS.WritableStream);

await output.stream(streamEvents(child.stdout as NodeJS.ReadableStream));
```

- [x] **Step 6: Run loop tests to confirm they all pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/loop.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [x] **Step 7: Run full test suite**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [x] **Step 8: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/lib/loop.ts src/cli/tests/loop.test.ts && git commit -m "$(cat <<'EOF'
refactor: replace sessionStream() in loop.ts with streamEvents()

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: Update plan.ts, new.ts, meditate-create.ts

**Shared pattern for all three commands:**

Each command's non-interactive Claude phase is replaced with:
1. `output.header({ mode, project, branch, pid: process.pid })`
2. Spawn Claude (existing args unchanged)
3. `await output.stream(streamEvents(child.stdout, { onSessionId: id => { sessionId = id; } }))`
4. `await exitPromise` (wait for process exit)
5. `if (sessionId) await output.info(\`trace: ${buildTracePath(cwd, sessionId)}\`)`
6. `await output.step("--- Launching interactive session ---")`
7. `spawnSync("claude", ["--resume", sessionId], { stdio: "inherit" })`

**Trace path helper** (inlined in each command -- intentional duplication, do not extract):
```ts
function buildTracePath(projectPath: string, sessionId: string): string {
  const encoded = projectPath.replace(/\//g, "-");
  return `${process.env.HOME ?? "~"}/.claude/projects/${encoded}/${sessionId}.jsonl`;
}
```

---

### Task 4: Update `plan.ts`

**Files:**
- Modify: `src/cli/commands/plan.ts`
- Modify: `src/cli/tests/` -- check for existing plan tests

- [x] **Step 1: Check for existing plan-specific tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && grep -r "planCommand\|runBrainstormKickoff" src/cli/tests/ 2>&1
```

Note which test files cover `plan.ts` -- update their mocks if they import from stream-formatter.

- [x] **Step 2: Rewrite `plan.ts`**

Replace the entire file with:

```ts
import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import * as output from "../lib/output.js";
import { streamEvents } from "../lib/stream-formatter.js";

const BRAINSTORM_TRIGGER = `\
Study specs/*.md and src/* in parallel using subagents to understand the project. \
Then invoke the Skill tool with skill name "superpowers:brainstorming".`;

function buildTracePath(projectPath: string, sessionId: string): string {
  const encoded = projectPath.replace(/\//g, "-");
  return `${process.env.HOME ?? "~"}/.claude/projects/${encoded}/${sessionId}.jsonl`;
}

export async function planCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);

  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error(
      "Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }

  const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: absPath, encoding: "utf8" });
  const branch = branchResult.stdout.trim() || "main";

  await output.header({ mode: "plan", project: absPath, branch, pid: process.pid });

  let sessionId: string | null = null;

  const child = spawn(
    "claude",
    ["-p", BRAINSTORM_TRIGGER, "--output-format", "stream-json", "--dangerously-skip-permissions"],
    { cwd: absPath, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
  );

  const exitPromise = new Promise<void>(res => child.on("close", () => res()));

  await output.stream(
    streamEvents(child.stdout as NodeJS.ReadableStream, {
      onSessionId: id => { sessionId = id; },
    })
  );
  await exitPromise;

  if (sessionId) {
    await output.info(`trace: ${buildTracePath(absPath, sessionId)}`);
  }
  await output.step("--- Launching interactive session ---");

  const resumeArgs = [
    "--dangerously-skip-permissions",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
  const result = spawnSync("claude", resumeArgs, {
    cwd: absPath,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 0);
}
```

- [x] **Step 3: Run all tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -15
```

Expected: all tests pass. If plan-specific tests fail, add `streamEvents` to their stream-formatter mock.

- [x] **Step 4: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/commands/plan.ts && git commit -m "$(cat <<'EOF'
feat: route plan command output through stream-formatter

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update `new.ts`

**Files:**
- Modify: `src/cli/commands/new.ts`

- [x] **Step 1: Add imports and `buildTracePath` helper to `new.ts`**

Add to the existing imports at the top:
```ts
import { streamEvents } from "../lib/stream-formatter.js";
```

Add `buildTracePath` helper (same as in plan.ts):
```ts
function buildTracePath(projectPath: string, sessionId: string): string {
  const encoded = projectPath.replace(/\//g, "-");
  return `${process.env.HOME ?? "~"}/.claude/projects/${encoded}/${sessionId}.jsonl`;
}
```

- [x] **Step 2: Replace `runKickoffSession()` with inline logic in `newCommand()`**

In `newCommand()`, find the call to `runKickoffSession` (line 42) and the interactive resume block (lines 44-55). Replace both with:

```ts
  const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: targetPath, encoding: "utf8" });
  const branch = branchResult.stdout.trim() || "main";

  await output.header({ mode: "new", project: targetPath, branch, pid: process.pid });

  const promptTemplate = readFileSync(getKickoffPromptPath(), "utf8");
  const prompt = buildKickoffPrompt(promptTemplate, projectName);

  let sessionId: string | null = null;

  const child = spawn(
    "claude",
    ["-p", prompt, "--output-format", "stream-json", "--dangerously-skip-permissions"],
    { cwd: targetPath, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
  );

  const exitPromise = new Promise<void>(res => child.on("close", () => res()));

  await output.stream(
    streamEvents(child.stdout as NodeJS.ReadableStream, {
      onSessionId: id => { sessionId = id; },
    })
  );
  await exitPromise;

  if (sessionId) {
    await output.info(`trace: ${buildTracePath(targetPath, sessionId)}`);
  }
  await output.step("--- Launching interactive session ---");

  const resumeArgs = [
    "--dangerously-skip-permissions",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
  const result = spawnSync("claude", resumeArgs, {
    cwd: targetPath,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 0);
```

- [x] **Step 3: Delete the now-unused `runKickoffSession` function** (lines 89-127 in the original file)

- [x] **Step 4: Run all tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -15
```

Expected: all tests pass.

- [x] **Step 5: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/commands/new.ts && git commit -m "$(cat <<'EOF'
feat: route new command output through stream-formatter

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update `meditate-create.ts`

**Files:**
- Modify: `src/cli/commands/meditate-create.ts`

- [x] **Step 1: Add imports and `buildTracePath` helper**

Add to existing imports:
```ts
import { streamEvents } from "../lib/stream-formatter.js";
```

Add helper:
```ts
function buildTracePath(projectPath: string, sessionId: string): string {
  const encoded = projectPath.replace(/\//g, "-");
  return `${process.env.HOME ?? "~"}/.claude/projects/${encoded}/${sessionId}.jsonl`;
}
```

- [x] **Step 2: Replace `runMeditateCreateKickoff()` with inline logic in `meditateCreateCommand()`**

Find the call to `runMeditateCreateKickoff` and the resume block (lines 27-33). Replace with:

```ts
  const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: absPath, encoding: "utf8" });
  const branch = branchResult.stdout.trim() || "main";

  await output.header({ mode: "meditate", project: absPath, branch, pid: process.pid });

  const promptPath = getMeditateCreatePromptPath();
  const promptText = readFileSync(promptPath, "utf8");
  const args = buildMeditateCreateKickoffArgs(promptText);

  let sessionId: string | null = null;

  const child = spawn("claude", args, {
    cwd: absPath,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const exitPromise = new Promise<void>(res => child.on("close", () => res()));

  await output.stream(
    streamEvents(child.stdout as NodeJS.ReadableStream, {
      onSessionId: id => { sessionId = id; },
    })
  );
  await exitPromise;

  if (sessionId) {
    await output.info(`trace: ${buildTracePath(absPath, sessionId)}`);
  }
  await output.step("--- Launching interactive session ---");

  const resumeArgs = ["--dangerously-skip-permissions", ...(sessionId ? ["--resume", sessionId] : [])];
  const result = spawnSync("claude", resumeArgs, { cwd: absPath, stdio: "inherit", env: process.env });
  process.exit(result.status ?? 0);
```

- [x] **Step 3: Delete the now-unused `runMeditateCreateKickoff` function** (lines 36-63 in original)

- [x] **Step 4: Run all tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -15
```

Expected: all tests pass.

- [x] **Step 5: Build to verify no TypeScript errors**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build 2>&1 | tail -15
```

Expected: build succeeds with no errors.

- [x] **Step 6: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/commands/meditate-create.ts && git commit -m "$(cat <<'EOF'
feat: route meditate-create command output through stream-formatter

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

- [x] **Run full test suite one last time**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [x] **Smoke test the build**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build && node dist/cli/index.js --help 2>&1 | head -10
```

Expected: help text prints correctly, no runtime errors.
