# Clack-Unified Stream Output Implementation Plan

> **Status: COMPLETE** — All tasks implemented, tested, committed, and tagged as `0.0.25`. Pushed to origin on 2026-04-07.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Route all Claude session output through a single `stream.message()` clack call per loop iteration, so the `│` gutter frames the entire session uniformly, and replace ASCII box-drawing block markers with `▶`/`◀` open/close pairs.

**Architecture:** `stream-formatter.ts` gains `mainAgentOpen` state (replaces `mainHeaderPrinted`) and emits `▶ MAIN AGENT` / `◀ MAIN AGENT` / `▶ SUBAGENT: <desc>` / `◀ SUBAGENT` markers instead of box-drawing borders. `loop.ts` replaces the `readline → processLine → stdout.write` loop with an async generator that is passed once to `await stream.message()` per iteration. No other files change.

**Tech Stack:** TypeScript, Node.js readline (async iterable), `@clack/prompts` v1.2.0 (`stream.message`), vitest

---

## Chunk 1: Update stream-formatter.ts

### Task 1: Update stream-formatter tests for new state shape and block markers

**Files:**
- Modify: `src/cli/tests/stream-formatter.test.ts`

- [x] **Step 1: Remove the `HEADER` constant and the `formatSubagentBlock` tests at the bottom**

Delete lines 4 and 348–376 (the `const HEADER` declaration and the two `formatSubagentBlock` `it()` blocks):

```ts
// DELETE this line at the top:
const HEADER = "┌─ MAIN AGENT ──────────────────────────────────────────\n";

// DELETE these two it() blocks entirely:
it("formatSubagentBlock: normal description produces correct framing", () => { ... });
it("formatSubagentBlock: long description clamps dashes to zero", () => { ... });
```

- [x] **Step 2: Update the "renders text content with header and token count" test**

Replace the assertion that uses `HEADER`:

```ts
// Before (line 33-35):
expect(output).toBe(
  HEADER + "Hello world\n◈ ctx: 1,234 tokens\n"
);

// After:
expect(output).toBe("▶ MAIN AGENT\nHello world\n◈ ctx: 1,234 tokens\n");
```

- [x] **Step 3: Update the "renders Agent tool_use as SUBAGENT START" test**

The `Agent` tool_use now closes the main agent block before opening the subagent. `mainHeaderPrinted` becomes `mainAgentOpen` and its value inverts (main is closed when subagent opens):

```ts
// Before (line 157-163):
const { output, nextState } = processLine(line, initialState());
expect(output).toContain("▶ SUBAGENT: Explore auth");
expect(nextState.pendingSubagentIds.has("agent-1")).toBe(true);
expect(nextState.subagentDescriptions.get("agent-1")).toBe("Explore auth");
expect(nextState.subagentBuffers.has("agent-1")).toBe(true);
expect(nextState.mainHeaderPrinted).toBe(true);

// After:
const { output, nextState } = processLine(line, initialState());
// initialState has mainAgentOpen: false, so no ◀ MAIN AGENT emitted
expect(output).toBe("▶ SUBAGENT: Explore auth\n");
expect(nextState.pendingSubagentIds.has("agent-1")).toBe(true);
expect(nextState.subagentDescriptions.get("agent-1")).toBe("Explore auth");
expect(nextState.subagentBuffers.has("agent-1")).toBe(true);
expect(nextState.mainAgentOpen).toBe(false);
```

- [x] **Step 4: Update the "buffers subagent assistant event" test — fix state shape**

Replace `mainHeaderPrinted` with `mainAgentOpen` in the constructed state (subagent is open → main is closed):

```ts
// Before (line 166-170):
const state: FormatterState = {
  pendingSubagentIds: new Set(["agent-1"]),
  subagentBuffers: new Map([["agent-1", ""]]),
  subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
  mainHeaderPrinted: true,
  lastMainCtxTotal: 0,
};

// After:
const state: FormatterState = {
  pendingSubagentIds: new Set(["agent-1"]),
  subagentBuffers: new Map([["agent-1", ""]]),
  subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
  mainAgentOpen: false,
  lastMainCtxTotal: 0,
};
```

- [x] **Step 5: Update the "flushes subagent buffer as labeled block on close" test**

The new format emits buffered content + `◀ SUBAGENT\n▶ MAIN AGENT\n`. No box-drawing borders:

```ts
// Replace the entire test:
it("flushes subagent buffer as labeled block on close", () => {
  const state: FormatterState = {
    pendingSubagentIds: new Set(["agent-1"]),
    subagentBuffers: new Map([["agent-1", "  → [glob] **/*.ts\n"]]),
    subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
    mainAgentOpen: false,
    lastMainCtxTotal: 0,
  };
  const line = JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "agent-1", content: [] }],
    },
  });
  const { output, nextState } = processLine(line, state);
  expect(output).toBe("  → [glob] **/*.ts\n◀ SUBAGENT\n▶ MAIN AGENT\n");
  expect(nextState.pendingSubagentIds.has("agent-1")).toBe(false);
  expect(nextState.mainAgentOpen).toBe(true);
});
```

- [x] **Step 6: Fix `mainHeaderPrinted` → `mainAgentOpen` in remaining state constructions**

Four more tests construct `FormatterState` directly. Update each:

```ts
// "ignores tool_result for non-subagent ids" (line 208-222):
// mainHeaderPrinted: false → mainAgentOpen: false

// "does not repeat header on consecutive assistant events" (line 224-242):
// mainHeaderPrinted: true → mainAgentOpen: true
// Also update assertion: expect(output).not.toContain("▶ MAIN AGENT")
// (no ▶ MAIN AGENT emitted when mainAgentOpen is already true)

// "suppresses ctx line when total has not grown" (line 309-325):
// mainHeaderPrinted: false → mainAgentOpen: false

// "never prints ctx line for subagent assistant events" (line 327-345):
// mainHeaderPrinted: true → mainAgentOpen: false
// (subagent is open = main is closed)
```

- [x] **Step 7: Replace the two `flushState` describe tests**

```ts
describe("flushState", () => {
  it("returns buffered content + close marker for each pending subagent", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", "  → [glob] **/*.ts\n"]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const output = flushState(state);
    expect(output).toBe("  → [glob] **/*.ts\n◀ SUBAGENT\n");
  });

  it("closes main agent block if open", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: true,
      lastMainCtxTotal: 0,
    };
    expect(flushState(state)).toBe("◀ MAIN AGENT\n");
  });

  it("returns empty string when nothing is open", () => {
    expect(flushState(initialState())).toBe("");
  });
});
```

- [x] **Step 8: Add new tests for block transition logic**

Add inside `describe("processLine", ...)` before the closing brace:

```ts
it("emits ▶ MAIN AGENT on first substantive main agent event", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text: "Hello" }],
      usage: { input_tokens: 100, output_tokens: 5 },
    },
  });
  const { output, nextState } = processLine(line, initialState());
  expect(output).toContain("▶ MAIN AGENT\n");
  expect(nextState.mainAgentOpen).toBe(true);
});

it("does not emit ▶ MAIN AGENT again on second event when already open", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text: "Second" }],
      usage: { input_tokens: 200, output_tokens: 5 },
    },
  });
  const stateWithOpen: FormatterState = {
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainAgentOpen: true,
    lastMainCtxTotal: 0,
  };
  const { output } = processLine(line, stateWithOpen);
  expect(output).not.toContain("▶ MAIN AGENT");
});

it("emits ◀ MAIN AGENT before ▶ SUBAGENT when main agent is open", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Agent", id: "a1", input: { description: "Do something" } }],
      usage: { input_tokens: 300, output_tokens: 5 },
    },
  });
  const stateWithOpen: FormatterState = {
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainAgentOpen: true,
    lastMainCtxTotal: 0,
  };
  const { output, nextState } = processLine(line, stateWithOpen);
  expect(output).toBe("◀ MAIN AGENT\n▶ SUBAGENT: Do something\n");
  expect(nextState.mainAgentOpen).toBe(false);
});

it("emits only ▶ SUBAGENT when main agent is not open (edge case: first event)", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Agent", id: "a1", input: { description: "First thing" } }],
      usage: { input_tokens: 300, output_tokens: 5 },
    },
  });
  const { output, nextState } = processLine(line, initialState());
  expect(output).toBe("▶ SUBAGENT: First thing\n");
  expect(output).not.toContain("◀ MAIN AGENT");
  expect(nextState.mainAgentOpen).toBe(false);
});
```

- [x] **Step 9: Run the tests and confirm they all fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/stream-formatter.test.ts
```

Expected: multiple failures (HEADER not defined, mainHeaderPrinted not in FormatterState, assertions on box borders fail).

---

### Task 2: Implement stream-formatter.ts changes

**Files:**
- Modify: `src/cli/lib/stream-formatter.ts`

- [x] **Step 1: Update the FormatterState interface — replace `mainHeaderPrinted` with `mainAgentOpen`**

```ts
// Before:
export interface FormatterState {
  pendingSubagentIds: Set<string>;
  subagentBuffers: Map<string, string>;
  subagentDescriptions: Map<string, string>;
  mainHeaderPrinted: boolean;
  lastMainCtxTotal: number;
}

// After:
export interface FormatterState {
  pendingSubagentIds: Set<string>;
  subagentBuffers: Map<string, string>;
  subagentDescriptions: Map<string, string>;
  mainAgentOpen: boolean;
  lastMainCtxTotal: number;
}
```

- [x] **Step 2: Update `initialState()` — replace `mainHeaderPrinted: false` with `mainAgentOpen: false`**

```ts
export function initialState(): FormatterState {
  return {
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainAgentOpen: false,
    lastMainCtxTotal: 0,
  };
}
```

- [x] **Step 3: Remove the `HEADER` constant and `formatSubagentBlock` function**

Delete lines 21 and 47–52:

```ts
// DELETE:
const HEADER = "┌─ MAIN AGENT ──────────────────────────────────────────\n";

// DELETE:
function formatSubagentBlock(desc: string, buf: string): string {
  const label = `┌─ SUBAGENT: ${desc} `;
  const totalWidth = 56;
  const dashes = "─".repeat(Math.max(0, totalWidth - label.length));
  return `\n${label}${dashes}\n${buf}◀ ${"─".repeat(totalWidth - 2)}\n\n`;
}
```

- [x] **Step 4: Update `flushState()` — emit buffered content + `◀ SUBAGENT`, close main agent if open**

```ts
export function flushState(state: FormatterState): string {
  let output = "";
  for (const id of state.pendingSubagentIds) {
    const buf = state.subagentBuffers.get(id) ?? "";
    output += buf + "◀ SUBAGENT\n";
  }
  if (state.mainAgentOpen) {
    output += "◀ MAIN AGENT\n";
  }
  return output;
}
```

- [x] **Step 5: Update the user/tool_result block in `processLine`**

The user event handler (around lines 82–119) handles `tool_result` events that close subagent blocks. Replace it entirely with:

```ts
// BEFORE (lines 82–119 in processLine):
if (event.type === "user") {
  const msg = event.message as { content?: unknown[] } | undefined;
  const userContent = msg?.content ?? [];
  let output = "";
  const nextPending = new Set(state.pendingSubagentIds);
  const nextBuffers = new Map(state.subagentBuffers);
  const nextDescriptions = new Map(state.subagentDescriptions);
  let nextHeaderPrinted = state.mainHeaderPrinted;

  for (const item of userContent) {
    const block = item as Record<string, unknown>;
    if (block.type === "tool_result") {
      const id = String(block.tool_use_id ?? "");
      if (nextPending.has(id)) {
        const desc = nextDescriptions.get(id) ?? "";
        const buf = nextBuffers.get(id) ?? "";
        output += formatSubagentBlock(desc, buf);
        nextPending.delete(id);
        nextBuffers.delete(id);
        nextDescriptions.delete(id);
      }
    }
  }

  if (nextPending.size === 0 && state.pendingSubagentIds.size > 0) {
    nextHeaderPrinted = false;
  }

  return {
    output,
    nextState: {
      ...state,
      pendingSubagentIds: nextPending,
      subagentBuffers: nextBuffers,
      subagentDescriptions: nextDescriptions,
      mainHeaderPrinted: nextHeaderPrinted,
    },
  };
}

// AFTER:
if (event.type === "user") {
  const msg = event.message as { content?: unknown[] } | undefined;
  const userContent = msg?.content ?? [];
  let output = "";
  const nextPending = new Set(state.pendingSubagentIds);
  const nextBuffers = new Map(state.subagentBuffers);
  const nextDescriptions = new Map(state.subagentDescriptions);
  let nextMainAgentOpen = state.mainAgentOpen;

  for (const item of userContent) {
    const block = item as Record<string, unknown>;
    if (block.type === "tool_result") {
      const id = String(block.tool_use_id ?? "");
      if (nextPending.has(id)) {
        const buf = nextBuffers.get(id) ?? "";
        // Emit buffered subagent content, close subagent, reopen main agent
        output += buf + "◀ SUBAGENT\n▶ MAIN AGENT\n";
        nextMainAgentOpen = true;
        nextPending.delete(id);
        nextBuffers.delete(id);
        nextDescriptions.delete(id);
      }
    }
  }

  return {
    output,
    nextState: {
      ...state,
      pendingSubagentIds: nextPending,
      subagentBuffers: nextBuffers,
      subagentDescriptions: nextDescriptions,
      mainAgentOpen: nextMainAgentOpen,
    },
  };
}
```

- [x] **Step 6: Update the main agent section in `processLine`**

Replace `mainHeaderPrinted` tracking and `HEADER` emission with `mainAgentOpen` and `▶ MAIN AGENT`:

```ts
// Find and update variable declaration (around line 165):
// BEFORE: let nextHeaderPrinted = state.mainHeaderPrinted;
// AFTER:  let nextMainAgentOpen = state.mainAgentOpen;

// Find and update the header block (around line 192):
// BEFORE:
if (!nextHeaderPrinted) {
  output += HEADER;
  nextHeaderPrinted = true;
}
// AFTER:
if (!nextMainAgentOpen) {
  output += "▶ MAIN AGENT\n";
  nextMainAgentOpen = true;
}

// Find and update the Agent tool_use case (around line 204):
// BEFORE:
if (name === "Agent") {
  const desc = String(input.description ?? input.prompt ?? "");
  output += `▶ SUBAGENT: ${desc}\n`;
  nextPending.add(String(b.id));
  nextDescriptions.set(String(b.id), desc);
  nextBuffers.set(String(b.id), "");
}
// AFTER:
if (name === "Agent") {
  const desc = String(input.description ?? input.prompt ?? "");
  if (nextMainAgentOpen) {
    output += "◀ MAIN AGENT\n";
    nextMainAgentOpen = false;
  }
  output += `▶ SUBAGENT: ${desc}\n`;
  nextPending.add(String(b.id));
  nextDescriptions.set(String(b.id), desc);
  nextBuffers.set(String(b.id), "");
}

// Find and update the return statement:
// BEFORE: mainHeaderPrinted: nextHeaderPrinted,
// AFTER:  mainAgentOpen: nextMainAgentOpen,
```

- [x] **Step 7: Run the tests and confirm they all pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/stream-formatter.test.ts
```

Expected: all tests pass.

- [x] **Step 8: Run the full test suite to check for regressions**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test
```

Expected: all tests pass (loop.test.ts may have some failures from the state shape change — those will be fixed in Chunk 2).

- [x] **Step 9: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/lib/stream-formatter.ts src/cli/tests/stream-formatter.test.ts && git commit -m "feat: replace box-drawing blocks with ▶/◀ open-close markers in stream-formatter"
```

---

## Chunk 2: Update loop.ts to use stream.message()

### Task 3: Update loop.ts tests for async generator + stream.message

**Files:**
- Modify: `src/cli/tests/loop.test.ts`

- [x] **Step 1: Add `stream` to the `@clack/prompts` mock**

```ts
// Before (line 21-28):
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  log: { warn: vi.fn(), step: vi.fn() },
  note: vi.fn(),
}));

// After:
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  log: { warn: vi.fn(), step: vi.fn() },
  note: vi.fn(),
  stream: {
    message: vi.fn(async (gen: AsyncIterable<string>) => {
      // Drain the generator so processLine is exercised in tests
      for await (const _ of gen) { /* no-op */ }
    }),
  },
}));
```

- [x] **Step 2: Update the stream-formatter mock to use `mainAgentOpen` instead of `mainHeaderPrinted`**

```ts
// Before (line 30-43):
vi.mock("../lib/stream-formatter.js", () => ({
  processLine: vi.fn(() => ({
    output: "",
    nextState: { pendingSubagentIds: new Set(), subagentBuffers: new Map(), subagentDescriptions: new Map(), mainHeaderPrinted: false, lastMainCtxTotal: 0 },
  })),
  initialState: vi.fn(() => ({
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainHeaderPrinted: false,
    lastMainCtxTotal: 0,
  })),
  flushState: vi.fn(() => ""),
}));

// After:
vi.mock("../lib/stream-formatter.js", () => ({
  processLine: vi.fn(() => ({
    output: "",
    nextState: { pendingSubagentIds: new Set(), subagentBuffers: new Map(), subagentDescriptions: new Map(), mainAgentOpen: false, lastMainCtxTotal: 0 },
  })),
  initialState: vi.fn(() => ({
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainAgentOpen: false,
    lastMainCtxTotal: 0,
  })),
  flushState: vi.fn(() => ""),
}));
```

- [x] **Step 3: Update `makeMockChild` — replace the EventEmitter rl with an async iterable**

The new `loop.ts` uses `for await (const line of rl)` instead of `rl.on('line', ...)`. Update the helper to return an async-iterable readline mock:

```ts
function makeMockChild(exitCode = 0, lines: string[] = []) {
  const stdoutEmitter = new EventEmitter();
  const stdinMock = { end: vi.fn(), pipe: vi.fn(), write: vi.fn() };

  const child = {
    pid: 42,
    stdin: stdinMock,
    stdout: stdoutEmitter,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "exit") setTimeout(() => cb(exitCode, null), 5);
    }),
  };

  // Return an async iterable — compatible with "for await (const line of rl)"
  const rlMock = {
    [Symbol.asyncIterator]: async function* () {
      for (const line of lines) {
        yield line;
      }
    },
  };

  vi.mocked(readline.createInterface).mockReturnValue(rlMock as any);
  vi.mocked(cp.spawn).mockReturnValue(child as any);

  return { child };
}
```

- [x] **Step 4: Update all `makeMockChild` call sites — remove `rlEmitter` usage**

The old tests used `rlEmitter.emit("close")` to end the readline. That's no longer needed — the async iterable ends naturally. Update each test:

```ts
// Before:
const { rlEmitter } = makeMockChild(0);
// ... later:
rlEmitter.emit("close");

// After:
makeMockChild(0);
// (no close emission needed)
```

Update all tests: `runs exactly max iterations`, `feeds each stdout line through processLine`, `calls log.warn when claude exits`, `calls log.warn when git push fails`, `prints PID at startup`, `retries git push with -u`, `warns only after retry also fails`, `spawns claude with correct flags`.

- [x] **Step 5: Replace the "feeds each stdout line through processLine and writes output" test**

The new test verifies `processLine` is called and `stream.message` is invoked — not `stdout.write`:

```ts
it("calls processLine for each line from readline and passes generator to stream.message", async () => {
  const testLine = '{"type":"assistant","message":{"content":[]}}';
  vi.mocked(formatter.processLine).mockReturnValue({
    output: "→ [read] file.ts\n",
    nextState: { pendingSubagentIds: new Set(), subagentBuffers: new Map(), subagentDescriptions: new Map(), mainAgentOpen: false, lastMainCtxTotal: 0 },
  });

  makeMockChild(0, [testLine]);
  mockGitBranch("main");

  await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });

  expect(formatter.processLine).toHaveBeenCalledWith(testLine, expect.any(Object));
  expect((clack as any).stream.message).toHaveBeenCalledTimes(1);
  // No stdout.write spy — output goes through stream.message
});
```

- [x] **Step 6: Add a test that stream.message is called once per iteration**

```ts
it("calls stream.message once per loop iteration", async () => {
  makeMockChild(0);
  mockGitBranch("main");

  await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 3 });

  expect((clack as any).stream.message).toHaveBeenCalledTimes(3);
});
```

- [x] **Step 7: Run the tests and confirm they fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/loop.test.ts
```

Expected: failures on `stream.message` not being called, `rlEmitter` references, and state shape.

---

### Task 4: Implement loop.ts changes

**Files:**
- Modify: `src/cli/lib/loop.ts`

- [x] **Step 1: Add `stream` to the `@clack/prompts` import**

```ts
// Before (line 4-11):
import {
  intro,
  outro,
  cancel,
  spinner,
  log,
  note,
} from "@clack/prompts";

// After:
import {
  intro,
  outro,
  cancel,
  spinner,
  log,
  note,
  stream,
} from "@clack/prompts";
```

- [x] **Step 2: Define `sessionStream` as an inner async generator inside `runLoop`, after the signal handler setup and before the while loop**

Add this function inside `runLoop`, after `process.on("SIGTERM", onSignal)` (around line 64) and before `try {`:

```ts
async function* sessionStream(
  spawnedChild: ReturnType<typeof spawn>
): AsyncGenerator<string> {
  const readStream = createReadStream(promptFile);
  readStream.pipe(spawnedChild.stdin as NodeJS.WritableStream);

  const rl = readline.createInterface({
    input: spawnedChild.stdout as NodeJS.ReadableStream,
    crlfDelay: Infinity,
  });

  let state = initialState();
  for await (const line of rl) {
    const { output, nextState } = processLine(line, state);
    state = nextState;
    if (output) yield output;
  }

  const flush = flushState(state);
  if (flush) yield flush;
}
```

- [x] **Step 3: Replace the readline + stdout.write block inside the while loop**

Find the section from "Feed prompt file into stdin" through the `log.warn` for non-zero exit (lines ~92–125) and replace with the generator call:

```ts
// REMOVE all of this:
// Feed prompt file into stdin
const readStream = createReadStream(promptFile);
readStream.pipe(child.stdin as NodeJS.WritableStream);

// Track exit code
let exitCode = 0;
const exitPromise = new Promise<void>((resolve) => {
  child.on("exit", (code) => {
    exitCode = code ?? 0;
    resolve();
  });
});

// Process stdout line-by-line through stream-formatter
const rl = readline.createInterface({
  input: child.stdout as NodeJS.ReadableStream,
  crlfDelay: Infinity,
});
let state = initialState();
rl.on("line", (line) => {
  const { output, nextState } = processLine(line, state);
  state = nextState;
  if (output) process.stdout.write(output);
});
await new Promise<void>((resolve) => rl.on("close", resolve));
const flush = flushState(state);
if (flush) process.stdout.write(flush);
await exitPromise;

currentPid = undefined;

if (exitCode !== 0) {
  log.warn(`claude exited with code ${exitCode}`);
}

// REPLACE with:
// Track exit code
let exitCode = 0;
const exitPromise = new Promise<void>((resolve) => {
  child.on("exit", (code) => {
    exitCode = code ?? 0;
    resolve();
  });
});

await stream.message(sessionStream(child));
await exitPromise;

currentPid = undefined;

if (exitCode !== 0) {
  log.warn(`claude exited with code ${exitCode}`);
}
```

- [x] **Step 4: Build to verify TypeScript compiles**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build 2>&1 | head -30
```

Expected: build succeeds with no TypeScript errors.

- [x] **Step 5: Run loop tests and confirm they pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/loop.test.ts
```

Expected: all tests pass.

- [x] **Step 6: Run the full test suite**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test
```

Expected: all tests pass.

- [x] **Step 7: Smoke test — run `ralph implement ralph-cli` manually and verify the `│` gutter frames the entire session**

Check the terminal output matches the expected format:
```
│  ▶ MAIN AGENT
│  → [tool] ToolSearch
│  ◈ ctx: N tokens
│  ◀ MAIN AGENT
│  ▶ SUBAGENT: ...
│  ◀ SUBAGENT
│  ▶ MAIN AGENT
│  ◀ MAIN AGENT
```

- [x] **Step 8: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/lib/loop.ts src/cli/tests/loop.test.ts && git commit -m "feat: route claude session output through clack stream.message() for unified gutter"
```
