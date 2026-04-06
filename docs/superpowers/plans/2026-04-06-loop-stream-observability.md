# Loop Stream Observability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `loop.sh`'s minimal jq filter with a Node.js stream-formatter that shows file paths for file-related tools, subagent boundaries, and context-window token counts on every main-agent turn.

**Architecture:** `src/cli/lib/stream-formatter.ts` compiled as a new tsup entry to `dist/cli/lib/stream-formatter.js`. `implement.ts` sets `RALPH_STREAM_FORMATTER` + `RALPH_STREAM_FORMATTER_CMD` env vars before spawning `loop.sh`. `loop.sh` pipes through the formatter if those vars are set, falls back to existing jq filter otherwise.

**Tech Stack:** Node.js (readline built-in), TypeScript, vitest, tsup ESM build

**Spec:** `docs/superpowers/specs/2026-04-06-loop-stream-observability-design.md`

---

## Chunk 1: stream-formatter module + tests

### Task 1: Write failing tests for stream-formatter core

**Files:**
- Create: `src/cli/tests/stream-formatter.test.ts`

- [ ] **Step 1: Write failing tests for processLine**

```typescript
// src/cli/tests/stream-formatter.test.ts
import { describe, it, expect } from "vitest";
import { processLine, initialState, type FormatterState } from "../lib/stream-formatter";

const HEADER = "┌─ MAIN AGENT ──────────────────────────────────────────\n";

describe("processLine", () => {
  it("ignores system events", () => {
    const line = JSON.stringify({ type: "system", session_id: "abc" });
    const { output } = processLine(line, initialState());
    expect(output).toBe("");
  });

  it("ignores result events", () => {
    const line = JSON.stringify({ type: "result", result: "done" });
    const { output } = processLine(line, initialState());
    expect(output).toBe("");
  });

  it("ignores non-JSON lines", () => {
    const { output } = processLine("not json", initialState());
    expect(output).toBe("");
  });

  it("renders text content with header and token count", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
        usage: { input_tokens: 1234, output_tokens: 10 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toBe(
      HEADER + "Hello world\n◈ ctx: 1,234 tokens\n"
    );
  });

  it("renders Read tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t1", input: { file_path: "/src/foo.ts" } }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [read] /src/foo.ts");
    expect(output).toContain("◈ ctx: 500 tokens");
  });

  it("renders Write tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", id: "t1", input: { file_path: "/out.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [write] /out.ts");
  });

  it("renders Edit tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Edit", id: "t1", input: { file_path: "/edit.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [edit] /edit.ts");
  });

  it("renders Grep tool_use with pattern and path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "foo", path: "src/" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [grep] foo  src/");
  });

  it("renders Grep without path when path is absent", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "bar" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [grep] bar");
    expect(output).not.toContain("undefined");
  });

  it("renders Glob tool_use with pattern", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Glob", id: "t1", input: { pattern: "**/*.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [glob] **/*.ts");
  });

  it("renders Bash tool_use with command", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: "npm test" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [bash] npm test");
  });

  it("truncates Bash command at 80 chars with ellipsis", () => {
    const longCmd = "a".repeat(100);
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: longCmd } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [bash] " + "a".repeat(80) + "…");
  });

  it("renders unknown tool with generic label", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "TodoWrite", id: "t1", input: {} }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [tool] TodoWrite");
  });

  it("renders Agent tool_use as SUBAGENT START and stores the id in state", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Agent", id: "agent-1", input: { description: "Explore auth" } }],
        usage: { input_tokens: 200, output_tokens: 5 },
      },
    });
    const { output, nextState } = processLine(line, initialState());
    expect(output).toContain("▶ SUBAGENT: Explore auth");
    expect(nextState.pendingSubagentIds.has("agent-1")).toBe(true);
  });

  it("emits SUBAGENT DONE when tool_result matches pending id", () => {
    const state: FormatterState = { pendingSubagentIds: new Set(["agent-1"]) };
    const line = JSON.stringify({ type: "tool_result", tool_use_id: "agent-1", content: "done" });
    const { output, nextState } = processLine(line, state);
    expect(output).toBe("◀ SUBAGENT DONE\n");
    expect(nextState.pendingSubagentIds.has("agent-1")).toBe(false);
  });

  it("ignores tool_result for non-subagent ids", () => {
    const state: FormatterState = { pendingSubagentIds: new Set() };
    const line = JSON.stringify({ type: "tool_result", tool_use_id: "some-other-id", content: "ok" });
    const { output } = processLine(line, state);
    expect(output).toBe("");
  });

  it("closes pending subagents on next assistant turn", () => {
    // If a subagent was dispatched but tool_result never arrived (unsupported by CLI),
    // a new assistant turn should close it
    const state: FormatterState = { pendingSubagentIds: new Set(["agent-1"]) };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "continuing" }],
        usage: { input_tokens: 300, output_tokens: 5 },
      },
    });
    const { output, nextState } = processLine(line, state);
    expect(output).toContain("◀ SUBAGENT DONE");
    expect(nextState.pendingSubagentIds.size).toBe(0);
  });

  it("omits token line when usage is absent", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    const { output } = processLine(line, initialState());
    expect(output).not.toContain("◈ ctx");
  });

  it("formats token count with thousands separator", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "x" }],
        usage: { input_tokens: 1234567, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("◈ ctx: 1,234,567 tokens");
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail (module not found)**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --run src/cli/tests/stream-formatter.test.ts 2>&1 | head -20
```

Expected: Error — `Cannot find module '../lib/stream-formatter'`

---

### Task 2: Implement stream-formatter.ts

**Files:**
- Create: `src/cli/lib/stream-formatter.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/cli/lib/stream-formatter.ts
import * as readline from "readline";

export interface FormatterState {
  pendingSubagentIds: Set<string>;
}

export function initialState(): FormatterState {
  return { pendingSubagentIds: new Set() };
}

const HEADER = "┌─ MAIN AGENT ──────────────────────────────────────────\n";

function formatToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
      return `→ [read] ${input.file_path}\n`;
    case "Write":
      return `→ [write] ${input.file_path}\n`;
    case "Edit":
      return `→ [edit] ${input.file_path}\n`;
    case "Grep": {
      const path = input.path ? `  ${input.path}` : "";
      return `→ [grep] ${input.pattern}${path}\n`;
    }
    case "Glob":
      return `→ [glob] ${input.pattern}\n`;
    case "Bash": {
      const cmd = String(input.command ?? "");
      const truncated = cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
      return `→ [bash] ${truncated}\n`;
    }
    default:
      return `→ [tool] ${name}\n`;
  }
}

export function processLine(
  line: string,
  state: FormatterState
): { output: string; nextState: FormatterState } {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { output: "", nextState: state };
  }

  // Close pending subagents when their tool_result arrives
  if (event.type === "tool_result") {
    const id = event.tool_use_id as string | undefined;
    if (id && state.pendingSubagentIds.has(id)) {
      const next: FormatterState = { pendingSubagentIds: new Set(state.pendingSubagentIds) };
      next.pendingSubagentIds.delete(id);
      return { output: "◀ SUBAGENT DONE\n", nextState: next };
    }
    return { output: "", nextState: state };
  }

  if (event.type !== "assistant") {
    return { output: "", nextState: state };
  }

  const msg = event.message as { content?: unknown[]; usage?: { input_tokens?: number } } | undefined;
  const content = msg?.content ?? [];
  const usage = msg?.usage;

  let output = "";
  const nextPending = new Set(state.pendingSubagentIds);

  // If there were pending subagents from last turn and no tool_result closed them,
  // close them now (CLI may not emit tool_result events)
  if (nextPending.size > 0) {
    for (const _id of nextPending) {
      output += "◀ SUBAGENT DONE\n";
    }
    nextPending.clear();
  }

  output += HEADER;

  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text") {
      output += String(b.text) + "\n";
    } else if (b.type === "tool_use") {
      const name = String(b.name);
      const input = (b.input ?? {}) as Record<string, unknown>;
      if (name === "Agent") {
        const desc = String(input.description ?? input.prompt ?? "");
        output += `▶ SUBAGENT: ${desc}\n`;
        nextPending.add(String(b.id));
      } else {
        output += formatToolUse(name, input);
      }
    }
  }

  if (typeof usage?.input_tokens === "number") {
    output += `◈ ctx: ${usage.input_tokens.toLocaleString("en-US")} tokens\n`;
  }

  return { output, nextState: { pendingSubagentIds: nextPending } };
}

// Only run as main entry point when executed directly
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`
) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let state = initialState();
  rl.on("line", (line) => {
    const { output, nextState } = processLine(line, state);
    state = nextState;
    if (output) process.stdout.write(output);
  });
}
```

- [ ] **Step 2: Run the tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --run src/cli/tests/stream-formatter.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/lib/stream-formatter.ts src/cli/tests/stream-formatter.test.ts && git commit -m "feat: add stream-formatter module with tests"
```

---

## Chunk 2: wiring — assets, implement, loop.sh, tsup

### Task 3: Add getStreamFormatterPath to assets.ts

**Files:**
- Modify: `src/cli/lib/assets.ts`
- Modify: `src/cli/tests/assets.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/cli/tests/assets.test.ts`:

```typescript
import { getStreamFormatterPath } from "../lib/assets";

// inside describe("assets", () => { ... })
it("getStreamFormatterPath returns a path ending in stream-formatter.ts or .js", () => {
  const p = getStreamFormatterPath();
  expect(p).toMatch(/stream-formatter\.(ts|js)$/);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --run src/cli/tests/assets.test.ts 2>&1 | tail -10
```

Expected: FAIL — `getStreamFormatterPath is not a function`

- [ ] **Step 3: Add the export to assets.ts**

Append to `src/cli/lib/assets.ts`:

```typescript
export function getStreamFormatterPath(): string {
  if (isProduction()) {
    // prod: __dirname = dist/cli/ → dist/cli/lib/stream-formatter.js
    return join(__dirname, "lib", "stream-formatter.js");
  } else {
    // dev: __dirname = src/cli/lib/ → src/cli/lib/stream-formatter.ts
    return join(__dirname, "stream-formatter.ts");
  }
}
```

- [ ] **Step 4: Run the assets tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --run src/cli/tests/assets.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/lib/assets.ts src/cli/tests/assets.test.ts && git commit -m "feat: add getStreamFormatterPath to assets"
```

---

### Task 4: Pass formatter env vars from implement.ts

**Files:**
- Modify: `src/cli/commands/implement.ts`

- [ ] **Step 1: Update implement.ts to set env vars before spawning loop.sh**

In `implement.ts`, update the imports to include `getStreamFormatterPath`:

```typescript
import { getLoopShPath, getStreamFormatterPath } from "../lib/assets";
```

Replace the `spawn` call (currently at line ~58) with:

```typescript
  // Determine formatter command: node in prod, tsx in dev
  const formatterCmd = typeof __RALPH_PROD__ !== "undefined" ? "node" : "tsx";
  const formatterPath = getStreamFormatterPath();

  const child = spawn(loopSh, args, {
    cwd: absPath,
    stdio: "inherit",
    env: {
      ...process.env,
      RALPH_STREAM_FORMATTER: formatterPath,
      RALPH_STREAM_FORMATTER_CMD: formatterCmd,
    },
    detached: true,
  });
```

- [ ] **Step 2: Run the smoke test to confirm implement command still compiles**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --run src/cli/tests/smoke.test.ts
```

Expected: PASS (no type errors or import failures).

- [ ] **Step 3: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/commands/implement.ts && git commit -m "feat: pass RALPH_STREAM_FORMATTER env vars to loop.sh"
```

---

### Task 5: Update loop.sh to use the formatter

**Files:**
- Modify: `loop.sh`

- [ ] **Step 1: Replace the jq pipe section in loop.sh**

Find the block starting at line 54 (`claude -p \`) through the `&` on line 66. Replace with:

```bash
    claude -p \
        --dangerously-skip-permissions \
        --output-format=stream-json \
        --model opus \
        < "$PROMPT_FILE" \
        | if [ -n "$RALPH_STREAM_FORMATTER" ] && [ -n "$RALPH_STREAM_FORMATTER_CMD" ]; then
              "$RALPH_STREAM_FORMATTER_CMD" "$RALPH_STREAM_FORMATTER" 2>/dev/null
          else
              jq -r '
                if .type == "assistant" then
                  .message.content[]? |
                  if .type == "text" then .text
                  elif .type == "tool_use" then "→ [tool] \(.name)"
                  else empty end
                else empty end
              ' 2>/dev/null
          fi &
```

- [ ] **Step 2: Verify loop.sh is still valid bash**

```bash
bash -n /Users/josu/Documents/projects/ralph-cli/loop.sh && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add loop.sh && git commit -m "feat: pipe loop.sh output through RALPH_STREAM_FORMATTER if set"
```

---

### Task 6: Add stream-formatter as tsup entry + build

**Files:**
- Modify: `tsup.config.ts`

- [ ] **Step 1: Add the new entry to tsup.config.ts**

Change the `entry` array from:

```typescript
entry: ["src/cli/index.ts", "src/cli/mcp/illumination-server.ts", "src/daemon/index.ts"],
```

to:

```typescript
entry: [
  "src/cli/index.ts",
  "src/cli/mcp/illumination-server.ts",
  "src/cli/lib/stream-formatter.ts",
  "src/daemon/index.ts",
],
```

- [ ] **Step 2: Build**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build 2>&1 | tail -20
```

Expected: Build succeeds. `dist/cli/lib/stream-formatter.js` exists.

- [ ] **Step 3: Verify formatter file was created**

```bash
ls -la /Users/josu/Documents/projects/ralph-cli/dist/cli/lib/stream-formatter.js
```

Expected: File exists.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --run
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add tsup.config.ts && git commit -m "build: add stream-formatter as tsup entry point"
```
