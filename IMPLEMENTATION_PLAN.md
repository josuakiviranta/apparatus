# Ink Unified Output Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all ralph command output to a unified Ink-based system via helper functions in `output.ts`, replacing Clack and raw `console.log` across all command files.

**Architecture:** A thin `output.ts` module exports plain functions (`step`, `info`, `warn`, `error`, `success`, `header`, `spinner`, `stream`) that wrap Ink internally — commands never import Ink or React directly. `stream-formatter.ts` changes its return type from `string` to `StreamEvent[]`, enabling the stream loop to render each event through Ink's React render cycle with colors.

**Tech Stack:** TypeScript, Ink 6.x (ESM), React 18, ink-spinner, ink-testing-library (dev), vitest

**Spec:** `docs/superpowers/specs/2026-04-08-ink-unified-output-design.md`

---

## Chunk 1: Dependencies + StreamEvent Types

### Task 1: Install new packages

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add ink-spinner and ink-testing-library**

```bash
npm install ink-spinner
npm install --save-dev ink-testing-library
```

- [ ] **Step 2: Verify install**

```bash
npm ls ink-spinner ink-testing-library
```

Expected: both listed without errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ink-spinner and ink-testing-library"
```

---

### Task 2: Add StreamEvent type and update stream-formatter return types

**Files:**
- Modify: `src/cli/lib/stream-formatter.ts`
- Modify: `src/cli/tests/stream-formatter.test.ts`

The `processLine` return type changes from `{ output: string; nextState }` to `{ events: StreamEvent[]; nextState }`. `flushState` changes from returning `string` to `StreamEvent[]`. The standalone CLI path (bottom of the file) serializes events back to plain text for debugging.

- [ ] **Step 1: Update stream-formatter tests first (TDD)**

Replace every `result.output` assertion with `result.events` assertions. Map each expected string to its equivalent event array. Full updated test file:

```ts
import { describe, it, expect } from "vitest";
import { processLine, initialState, flushState, type FormatterState, type StreamEvent } from "../lib/stream-formatter";

// Helper: serialize events to the old plain-text format for compact assertions
function eventsToText(events: StreamEvent[]): string {
  return events.map(e => {
    switch (e.type) {
      case "main_agent_open":   return "▶▶▶ MAIN AGENT\n";
      case "main_agent_close":  return "◀◀◀ MAIN AGENT\n\n";
      case "subagent_open":     return `▶ SUBAGENT: ${e.description}\n`;
      case "subagent_close":    return "◀ SUBAGENT\n";
      case "text":              return (e.indented ? "  " : "") + e.content + "\n";
      case "tool":              return (e.indented ? "  " : "") + `→ [${e.name}] ${e.label}\n`;
      case "ctx":               return `◈ ctx: ${e.tokens.toLocaleString("en-US")} tokens\n`;
    }
  }).join("");
}

describe("processLine", () => {
  it("ignores system events", () => {
    const line = JSON.stringify({ type: "system", session_id: "abc" });
    const { events } = processLine(line, initialState());
    expect(events).toEqual([]);
  });

  it("ignores result events", () => {
    const line = JSON.stringify({ type: "result", result: "done" });
    const { events } = processLine(line, initialState());
    expect(events).toEqual([]);
  });

  it("ignores non-JSON lines", () => {
    const { events } = processLine("not json", initialState());
    expect(events).toEqual([]);
  });

  it("renders text content with header and token count", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
        usage: { input_tokens: 1234, output_tokens: 10 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toBe("▶▶▶ MAIN AGENT\nHello world\n◈ ctx: 1,234 tokens\n");
  });

  it("renders Read tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t1", input: { file_path: "/src/foo.ts" } }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    const text = eventsToText(events);
    expect(text).toContain("→ [read] /src/foo.ts");
    expect(text).toContain("◈ ctx: 500 tokens");
  });

  it("renders Write tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", id: "t1", input: { file_path: "/out.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toContain("→ [write] /out.ts");
  });

  it("renders Edit tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Edit", id: "t1", input: { file_path: "/edit.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toContain("→ [edit] /edit.ts");
  });

  it("renders Grep tool_use with pattern and path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "foo", path: "src/" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toContain("→ [grep] foo  src/");
  });

  it("renders Grep without path when path is absent", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "bar" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    const text = eventsToText(events);
    expect(text).toContain("→ [grep] bar");
    expect(text).not.toContain("undefined");
  });

  it("renders Glob tool_use with pattern", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Glob", id: "t1", input: { pattern: "**/*.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toContain("→ [glob] **/*.ts");
  });

  it("renders Bash tool_use with command", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: "npm test" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toContain("→ [bash] npm test");
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
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toContain("→ [bash] " + "a".repeat(80) + "…");
  });

  it("renders unknown tool with generic label", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "TodoWrite", id: "t1", input: {} }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toContain("→ [tool] TodoWrite");
  });

  it("renders Agent tool_use as SUBAGENT START and stores id, description, buffer in state", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Agent", id: "agent-1", input: { description: "Explore auth" } }],
        usage: { input_tokens: 200, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, initialState());
    expect(events).toEqual([]);
    expect(nextState.pendingSubagentIds.has("agent-1")).toBe(true);
    expect(nextState.subagentDescriptions.get("agent-1")).toBe("Explore auth");
    expect(nextState.subagentBuffers.has("agent-1")).toBe(true);
    expect(nextState.mainAgentOpen).toBe(false);
  });

  it("buffers subagent assistant event, no immediate output", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", []]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "agent-1",
      message: {
        content: [{ type: "tool_use", name: "Glob", id: "t1", input: { pattern: "**/*.ts" } }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, state);
    expect(events).toEqual([]);
    const buf = nextState.subagentBuffers.get("agent-1")!;
    expect(buf).toHaveLength(1);
    expect(buf[0]).toEqual({ type: "tool", name: "glob", label: "**/*.ts", indented: true });
  });

  it("flushes subagent buffer with header at close", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", [
        { type: "tool", name: "glob", label: "**/*.ts", indented: true },
      ] as StreamEvent[]]]),
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
    const { events, nextState } = processLine(line, state);
    expect(eventsToText(events)).toBe("▶ SUBAGENT: Explore auth\n  → [glob] **/*.ts\n◀ SUBAGENT\n");
    expect(nextState.pendingSubagentIds.has("agent-1")).toBe(false);
  });

  it("ignores tool_result for non-subagent ids", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "some-other-id", content: "ok" }] },
    });
    const { events } = processLine(line, state);
    expect(events).toEqual([]);
  });

  it("does not repeat header on consecutive assistant events", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: true,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t2", input: { file_path: "/b.ts" } }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, state);
    const text = eventsToText(events);
    expect(text).not.toContain("▶ MAIN AGENT");
    expect(text).toContain("→ [read] /b.ts");
  });

  it("skips events with no substantive content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "   " }],
        usage: { input_tokens: 50, output_tokens: 1 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toEqual([]);
  });

  it("sums cache tokens into ctx total", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 1000, cache_read_input_tokens: 90000, cache_creation_input_tokens: 5000 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toContain("◈ ctx: 96,000 tokens");
  });

  it("omits ctx event when usage is absent", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    const { events } = processLine(line, initialState());
    expect(events.find(e => e.type === "ctx")).toBeUndefined();
  });

  it("formats token count with thousands separator", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "x" }],
        usage: { input_tokens: 1234567, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(eventsToText(events)).toContain("◈ ctx: 1,234,567 tokens");
  });

  it("prints ctx when total grows, suppresses when equal", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 1000, output_tokens: 5 },
      },
    });
    const { events: e1, nextState: s1 } = processLine(line, initialState());
    expect(eventsToText(e1)).toContain("◈ ctx: 1,000 tokens");
    expect(s1.lastMainCtxTotal).toBe(1000);

    const { events: e2 } = processLine(line, s1);
    expect(eventsToText(e2)).not.toContain("◈ ctx");
  });

  it("suppresses ctx when total has not grown", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: false,
      lastMainCtxTotal: 5000,
    };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "same size" }],
        usage: { input_tokens: 5000, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, state);
    expect(events.find(e => e.type === "ctx")).toBeUndefined();
  });

  it("never emits ctx for subagent assistant events", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", []]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "agent-1",
      message: {
        content: [{ type: "tool_use", name: "Glob", id: "t1", input: { pattern: "**/*.ts" } }],
        usage: { input_tokens: 9999, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, state);
    expect(events).toEqual([]);
  });

  it("emits main_agent_open on first substantive main agent event", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello" }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, initialState());
    expect(events[0]).toEqual({ type: "main_agent_open" });
    expect(nextState.mainAgentOpen).toBe(true);
  });

  it("does not emit main_agent_open again on second event when already open", () => {
    const stateWithOpen: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: true,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Second" }],
        usage: { input_tokens: 200, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, stateWithOpen);
    expect(events.filter(e => e.type === "main_agent_open")).toHaveLength(0);
  });

  it("emits main_agent_close when main agent is open and Agent is dispatched", () => {
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
    const { events, nextState } = processLine(line, stateWithOpen);
    expect(events).toEqual([{ type: "main_agent_close" }]);
    expect(nextState.mainAgentOpen).toBe(false);
  });

  it("produces no events when Agent is dispatched and main agent is not open", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Agent", id: "a1", input: { description: "First thing" } }],
        usage: { input_tokens: 300, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, initialState());
    expect(events).toEqual([]);
    expect(nextState.pendingSubagentIds.has("a1")).toBe(true);
  });

  it("produces no events when multiple parallel Agent calls are dispatched", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Agent", id: "a1", input: { description: "Task 1" } },
          { type: "tool_use", name: "Agent", id: "a2", input: { description: "Task 2" } },
        ],
        usage: { input_tokens: 400, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, initialState());
    expect(events).toEqual([]);
    expect(nextState.pendingSubagentIds.has("a1")).toBe(true);
    expect(nextState.pendingSubagentIds.has("a2")).toBe(true);
  });

  it("does not open MAIN AGENT when first of two parallel subagents closes", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["a1", "a2"]),
      subagentBuffers: new Map([
        ["a1", [{ type: "tool", name: "read", label: "/foo.ts", indented: true }] as StreamEvent[]],
        ["a2", []],
      ]),
      subagentDescriptions: new Map([["a1", "Task 1"], ["a2", "Task 2"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "a1", content: [] }] },
    });
    const { events, nextState } = processLine(line, state);
    expect(eventsToText(events)).toBe("▶ SUBAGENT: Task 1\n  → [read] /foo.ts\n◀ SUBAGENT\n");
    expect(nextState.pendingSubagentIds.has("a1")).toBe(false);
    expect(nextState.pendingSubagentIds.has("a2")).toBe(true);
    expect(nextState.mainAgentOpen).toBe(false);
  });

  it("full round-trip: dispatch 2 parallel agents, both close, main agent continues", () => {
    let state = initialState();

    const dispatchLine = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Running two tasks in parallel." },
          { type: "tool_use", name: "Agent", id: "a1", input: { description: "Task Alpha" } },
          { type: "tool_use", name: "Agent", id: "a2", input: { description: "Task Beta" } },
        ],
        usage: { input_tokens: 300, output_tokens: 5 },
      },
    });
    const { events: e1, nextState: s1 } = processLine(dispatchLine, state);
    state = s1;
    expect(eventsToText(e1)).toBe("▶▶▶ MAIN AGENT\nRunning two tasks in parallel.\n◀◀◀ MAIN AGENT\n\n");

    // subagent a1 tool call
    const subA1Line = JSON.stringify({
      type: "assistant", parent_tool_use_id: "a1",
      message: { content: [{ type: "tool_use", name: "Read", id: "t1", input: { file_path: "/alpha.ts" } }], usage: { input_tokens: 100, output_tokens: 2 } },
    });
    const { events: e2, nextState: s2 } = processLine(subA1Line, state);
    state = s2;
    expect(e2).toEqual([]);

    // subagent a2 tool call
    const subA2Line = JSON.stringify({
      type: "assistant", parent_tool_use_id: "a2",
      message: { content: [{ type: "tool_use", name: "Read", id: "t2", input: { file_path: "/beta.ts" } }], usage: { input_tokens: 100, output_tokens: 2 } },
    });
    const { events: e3, nextState: s3 } = processLine(subA2Line, state);
    state = s3;
    expect(e3).toEqual([]);

    // a1 closes
    const closeA1 = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a1", content: [] }] } });
    const { events: e4, nextState: s4 } = processLine(closeA1, state);
    state = s4;
    expect(eventsToText(e4)).toBe("▶ SUBAGENT: Task Alpha\n  → [read] /alpha.ts\n◀ SUBAGENT\n");

    // a2 closes
    const closeA2 = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a2", content: [] }] } });
    const { events: e5, nextState: s5 } = processLine(closeA2, state);
    state = s5;
    expect(eventsToText(e5)).toBe("▶ SUBAGENT: Task Beta\n  → [read] /beta.ts\n◀ SUBAGENT\n");
    expect(state.pendingSubagentIds.size).toBe(0);

    // main agent resumes
    const resumeLine = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "All done." }], usage: { input_tokens: 600, output_tokens: 5 } },
    });
    const { events: e6 } = processLine(resumeLine, state);
    expect(eventsToText(e6)).toContain("▶▶▶ MAIN AGENT\n");
    expect(eventsToText(e6)).toContain("All done.\n");
  });
});

describe("flushState", () => {
  it("returns events for each pending subagent", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", [
        { type: "tool", name: "glob", label: "**/*.ts", indented: true },
      ] as StreamEvent[]]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const events = flushState(state);
    expect(eventsToText(events)).toBe("▶ SUBAGENT: Explore auth\n  → [glob] **/*.ts\n◀ SUBAGENT\n");
  });

  it("closes main agent block if open", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: true,
      lastMainCtxTotal: 0,
    };
    const events = flushState(state);
    expect(eventsToText(events)).toBe("◀◀◀ MAIN AGENT\n\n");
  });

  it("returns empty array when nothing is open", () => {
    expect(flushState(initialState())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
npm test -- src/cli/tests/stream-formatter.test.ts
```

Expected: many failures (`events` property does not exist on result).

- [ ] **Step 3: Update stream-formatter.ts**

Change `FormatterState.subagentBuffers` from `Map<string, string>` to `Map<string, StreamEvent[]>`. Change `processLine` return from `{ output: string }` to `{ events: StreamEvent[] }`. Change `flushState` return from `string` to `StreamEvent[]`.

Export the `StreamEvent` type. Keep the standalone CLI path (bottom of file) working by serializing events to text.

Key changes:
- `subagentBuffers: Map<string, StreamEvent[]>` (was `Map<string, string>`)
- `processLine(...)`: `{ events: StreamEvent[]; nextState: FormatterState }` (was `{ output: string; nextState }`)
- `flushState(...)`: `StreamEvent[]` (was `string`)
- Subagent buffer accumulates `StreamEvent[]` instead of concatenated strings
- Standalone CLI path: serialize `StreamEvent[]` to text via a `serializeEvent(e: StreamEvent): string` helper

New `StreamEvent` type to add at top of file:
```ts
export type StreamEvent =
  | { type: "main_agent_open" }
  | { type: "main_agent_close" }
  | { type: "subagent_open"; description: string }
  | { type: "subagent_close" }
  | { type: "text"; content: string; indented?: boolean }
  | { type: "tool"; name: string; label: string; indented?: boolean }
  | { type: "ctx"; tokens: number }
```

New `serializeEvent` helper for standalone CLI path:
```ts
function serializeEvent(e: StreamEvent): string {
  switch (e.type) {
    case "main_agent_open":  return "▶▶▶ MAIN AGENT\n";
    case "main_agent_close": return "◀◀◀ MAIN AGENT\n\n";
    case "subagent_open":    return `▶ SUBAGENT: ${e.description}\n`;
    case "subagent_close":   return "◀ SUBAGENT\n";
    case "text":             return (e.indented ? "  " : "") + e.content + "\n";
    case "tool":             return (e.indented ? "  " : "") + `→ [${e.name}] ${e.label}\n`;
    case "ctx":              return `◈ ctx: ${e.tokens.toLocaleString("en-US")} tokens\n`;
  }
}
```

Standalone CLI path becomes:
```ts
rl.on("line", (line) => {
  const { events, nextState } = processLine(line, state);
  state = nextState;
  for (const e of events) process.stdout.write(serializeEvent(e));
});
rl.on("close", () => {
  for (const e of flushState(state)) process.stdout.write(serializeEvent(e));
});
```

- [ ] **Step 4: Run tests — verify they all pass**

```bash
npm test -- src/cli/tests/stream-formatter.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/stream-formatter.ts src/cli/tests/stream-formatter.test.ts
git commit -m "feat: stream-formatter emits StreamEvent[] instead of plain text"
```

---

## Chunk 2: UI Components

### Task 3: Create shared Ink components

**Files:**
- Create: `src/cli/components/ui.tsx`
- Create: `src/cli/tests/ui.test.tsx`

- [ ] **Step 1: Write failing tests for Step, Info, Warn, Error, Success**

Create `src/cli/tests/ui.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Step, Info, Warn, Error as ErrorLine, Success } from "../components/ui.js";

describe("Step", () => {
  it("renders with ❯ prefix", () => {
    const { lastFrame } = render(<Step text="Starting session..." />);
    expect(lastFrame()).toContain("❯ Starting session...");
  });
});

describe("Info", () => {
  it("renders without prefix", () => {
    const { lastFrame } = render(<Info text="Session already running" />);
    expect(lastFrame()).toContain("Session already running");
    expect(lastFrame()).not.toContain("❯");
    expect(lastFrame()).not.toContain("✔");
  });
});

describe("Warn", () => {
  it("renders with ⚠ prefix", () => {
    const { lastFrame } = render(<Warn text="claude exited with code 1" />);
    expect(lastFrame()).toContain("⚠ claude exited with code 1");
  });
});

describe("Error", () => {
  it("renders with ✖ prefix", () => {
    const { lastFrame } = render(<ErrorLine text="Folder not found" />);
    expect(lastFrame()).toContain("✖ Folder not found");
  });
});

describe("Success", () => {
  it("renders with ✔ prefix", () => {
    const { lastFrame } = render(<Success text="git push done" />);
    expect(lastFrame()).toContain("✔ git push done");
  });
});
```

- [ ] **Step 2: Run — verify all fail**

```bash
npm test -- src/cli/tests/ui.test.tsx
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/cli/components/ui.tsx` with basic output components**

```tsx
import React, { useEffect, useState } from "react";
import { Box, Text, useApp, Static } from "ink";
import InkSpinner from "ink-spinner";
import type { StreamEvent } from "../lib/stream-formatter.js";

export function Step({ text }: { text: string }) {
  return <Text color="cyan">❯ {text}</Text>;
}

export function Info({ text }: { text: string }) {
  return <Text dimColor>{text}</Text>;
}

export function Warn({ text }: { text: string }) {
  return <Text color="yellow">⚠ {text}</Text>;
}

export function Error({ text }: { text: string }) {
  return <Text color="red">✖ {text}</Text>;
}

export function Success({ text }: { text: string }) {
  return <Text color="green">✔ {text}</Text>;
}
```

- [ ] **Step 4: Run — verify basic component tests pass**

```bash
npm test -- src/cli/tests/ui.test.tsx
```

Expected: all green.

- [ ] **Step 5: Write failing tests for Header**

Add to `src/cli/tests/ui.test.tsx`:

```tsx
import { Header } from "../components/ui.js";

describe("Header", () => {
  it("renders mode and project", () => {
    const { lastFrame } = render(<Header mode="implement" project="/my/project" branch="main" pid={1234} />);
    const frame = lastFrame()!;
    expect(frame).toContain("implement");
    expect(frame).toContain("/my/project");
    expect(frame).toContain("main");
    expect(frame).toContain("1234");
  });

  it("renders without branch when not provided", () => {
    const { lastFrame } = render(<Header mode="meditate" project="/my/project" pid={5678} />);
    const frame = lastFrame()!;
    expect(frame).toContain("meditate");
    expect(frame).toContain("5678");
  });
});
```

- [ ] **Step 6: Run — verify Header tests fail**

```bash
npm test -- src/cli/tests/ui.test.tsx
```

Expected: FAIL (Header not exported).

- [ ] **Step 7: Add Header to ui.tsx**

```tsx
export function Header({ mode, project, branch, pid }: {
  mode: string;
  project: string;
  branch?: string;
  pid?: number;
}) {
  const line1 = [mode, branch, project].filter(Boolean).join("  ·  ");
  const line2 = pid !== undefined ? `PID ${pid}   ·  Ctrl+C or: kill ${pid}` : undefined;
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      <Text>{line1}</Text>
      {line2 && <Text dimColor>{line2}</Text>}
    </Box>
  );
}
```

- [ ] **Step 8: Run — verify Header tests pass**

```bash
npm test -- src/cli/tests/ui.test.tsx
```

Expected: all green.

- [ ] **Step 9: Write failing tests for StreamLine**

Add to `src/cli/tests/ui.test.tsx`:

```tsx
import { StreamLine } from "../components/ui.js";
import type { StreamEvent } from "../lib/stream-formatter.js";

describe("StreamLine", () => {
  it("renders main_agent_open in bold cyan", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "main_agent_open" }} />);
    expect(lastFrame()).toContain("▶▶▶ MAIN AGENT");
  });

  it("renders main_agent_close (same marker, not bold)", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "main_agent_close" }} />);
    expect(lastFrame()).toContain("◀◀◀ MAIN AGENT");
  });

  it("renders subagent_open with description", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "subagent_open", description: "check output" }} />);
    expect(lastFrame()).toContain("▶ SUBAGENT: check output");
  });

  it("renders subagent_close", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "subagent_close" }} />);
    expect(lastFrame()).toContain("◀ SUBAGENT");
  });

  it("renders text content", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "text", content: "Hello world" }} />);
    expect(lastFrame()).toContain("Hello world");
  });

  it("renders indented text with 2-space indent", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "text", content: "Subagent text", indented: true }} />);
    expect(lastFrame()).toContain("  Subagent text");
  });

  it("renders tool line with name and label", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "tool", name: "read", label: "/src/foo.ts" }} />);
    expect(lastFrame()).toContain("→ [read] /src/foo.ts");
  });

  it("renders indented tool line", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "tool", name: "bash", label: "npm test", indented: true }} />);
    expect(lastFrame()).toContain("  → [bash] npm test");
  });

  it("renders ctx with token count", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "ctx", tokens: 45231 }} />);
    expect(lastFrame()).toContain("◈ ctx: 45,231 tokens");
  });
});
```

- [ ] **Step 10: Run — verify StreamLine tests fail**

```bash
npm test -- src/cli/tests/ui.test.tsx
```

Expected: FAIL (StreamLine not exported).

- [ ] **Step 11: Add StreamLine and StreamOutput to ui.tsx**

```tsx
export function StreamLine({ event }: { event: StreamEvent }) {
  switch (event.type) {
    case "main_agent_open":
      return <Text bold color="cyan">▶▶▶ MAIN AGENT</Text>;
    case "main_agent_close":
      return <Text color="cyan">◀◀◀ MAIN AGENT</Text>;
    case "subagent_open":
      return <Text bold color="yellow">▶ SUBAGENT: <Text bold={false} color="yellow">{event.description}</Text></Text>;
    case "subagent_close":
      return <Text color="yellow">◀ SUBAGENT</Text>;
    case "text":
      return <Text>{event.indented ? "  " : ""}{event.content}</Text>;
    case "tool":
      return <Text dimColor>{event.indented ? "  " : ""}→ [{event.name}] {event.label}</Text>;
    case "ctx":
      return <Text dimColor color="magenta">◈ ctx: {event.tokens.toLocaleString("en-US")} tokens</Text>;
  }
}

export function StreamOutput({ iter }: { iter: AsyncIterable<StreamEvent> }) {
  const { exit } = useApp();
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    (async () => {
      for await (const event of iter) {
        setEvents(prev => [...prev, event]);
      }
      exit();
    })();
  }, []);

  return (
    <Static items={events}>
      {(event, i) => <StreamLine key={i} event={event} />}
    </Static>
  );
}
```

- [ ] **Step 12: Run — verify all ui tests pass**

```bash
npm test -- src/cli/tests/ui.test.tsx
```

Expected: all green.

- [ ] **Step 13: Add SpinnerLine to ui.tsx** (no separate test — tested indirectly via output.ts tests)

```tsx
export function SpinnerLine({ label, fn }: {
  label: string;
  fn: () => Promise<void>;
}) {
  const { exit } = useApp();
  const [state, setState] = useState<"running" | "done" | "failed">("running");
  const [msg, setMsg] = useState(label);

  useEffect(() => {
    fn()
      .then(() => { setMsg(`${label} done`); setState("done"); exit(); })
      .catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        setMsg(errMsg); setState("failed"); exit();
      });
  }, []);

  if (state === "done")   return <Text color="green">✔ {msg}</Text>;
  if (state === "failed") return <Text color="yellow">⚠ {msg}</Text>;
  return <Text color="cyan"><InkSpinner type="dots" /> {label}</Text>;
}
```

- [ ] **Step 14: Commit**

```bash
git add src/cli/components/ui.tsx src/cli/tests/ui.test.tsx
git commit -m "feat: add shared Ink UI components (Step, Info, Warn, Error, Success, Header, StreamLine, StreamOutput, SpinnerLine)"
```

---

## Chunk 3: output.ts

### Task 4: Create the output API

**Files:**
- Create: `src/cli/lib/output.ts`
- Create: `src/cli/tests/output.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/cli/tests/output.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import React from "react";

// Mock Ink's render to capture what gets rendered
vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return {
    ...actual,
    render: vi.fn((el) => {
      // Use real render but capture
      const instance = actual.render(el);
      return instance;
    }),
  };
});

import * as output from "../lib/output.js";

describe("output.step", () => {
  it("renders without throwing", async () => {
    await expect(output.step("Starting...")).resolves.toBeUndefined();
  });
});

describe("output.error", () => {
  it("renders without throwing", async () => {
    await expect(output.error("Something failed")).resolves.toBeUndefined();
  });
});

describe("output.spinner", () => {
  it("runs fn and resolves with its return value", async () => {
    const result = await output.spinner("working...", async () => "done");
    expect(result).toBe("done");
  });

  it("propagates errors thrown by fn", async () => {
    await expect(
      output.spinner("working...", async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
  });
});

describe("output.stream", () => {
  it("consumes all events from the async iterable", async () => {
    async function* events() {
      yield { type: "main_agent_open" } as const;
      yield { type: "text", content: "Hello" } as const;
      yield { type: "main_agent_close" } as const;
    }
    await expect(output.stream(events())).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — verify all fail**

```bash
npm test -- src/cli/tests/output.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/cli/lib/output.ts`**

```ts
import React from "react";
import { render } from "ink";
import {
  Step, Info, Warn, Error as ErrorComponent, Success,
  Header, SpinnerLine, StreamOutput,
} from "../components/ui.js";
import type { StreamEvent } from "./stream-formatter.js";

// waitUntilRenderFlush() ensures the frame is written to stdout before we unmount.
// Without it, unmount() may fire before Ink flushes the render, producing no output.
async function renderOnce(el: React.ReactElement): Promise<void> {
  const { unmount, waitUntilRenderFlush } = render(el);
  await waitUntilRenderFlush();
  unmount();
}

export async function step(msg: string): Promise<void> {
  await renderOnce(React.createElement(Step, { text: msg }));
}

export async function info(msg: string): Promise<void> {
  await renderOnce(React.createElement(Info, { text: msg }));
}

export async function warn(msg: string): Promise<void> {
  await renderOnce(React.createElement(Warn, { text: msg }));
}

export async function error(msg: string): Promise<void> {
  await renderOnce(React.createElement(ErrorComponent, { text: msg }));
}

export async function success(msg: string): Promise<void> {
  await renderOnce(React.createElement(Success, { text: msg }));
}

export async function header(opts: {
  mode: string;
  project: string;
  branch?: string;
  pid?: number;
}): Promise<void> {
  await renderOnce(React.createElement(Header, opts));
}

export async function spinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let capturedResult: { ok: true; value: T } | { ok: false; error: unknown } | null = null;

  const trackingFn = async (): Promise<void> => {
    try {
      const value = await fn();
      capturedResult = { ok: true, value };
    } catch (err) {
      capturedResult = { ok: false, error: err };
      throw err;
    }
  };

  const { waitUntilExit } = render(
    React.createElement(SpinnerLine, { label, fn: trackingFn })
  );
  await waitUntilExit();

  if (!capturedResult) throw new Error("spinner: fn never resolved");
  if (!capturedResult.ok) throw capturedResult.error;
  return capturedResult.value;
}

export async function stream(iter: AsyncIterable<StreamEvent>): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(StreamOutput, { iter })
  );
  await waitUntilExit();
}
```

- [ ] **Step 4: Run — verify output tests pass**

```bash
npm test -- src/cli/tests/output.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/output.ts src/cli/tests/output.test.ts
git commit -m "feat: add output.ts — unified Ink output API"
```

---

## Chunk 4: loop.ts Migration

### Task 5: Update loop.ts to use output.ts and StreamEvent

**Files:**
- Modify: `src/cli/lib/loop.ts`
- Modify: `src/cli/tests/loop.test.ts`

- [ ] **Step 1: Update loop.test.ts mocks first**

Replace the `@clack/prompts` mock and `stream-formatter` mock. The test now mocks `../lib/output.js` instead of `@clack/prompts`, and the formatter mock returns `events` instead of `output`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock("readline", () => ({
  default: { createInterface: vi.fn() },
  createInterface: vi.fn(),
}));

vi.mock("../lib/output.js", () => ({
  header: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  error: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  spinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  stream: vi.fn(async (iter: AsyncIterable<unknown>) => {
    for await (const _ of iter) { /* consume */ }
  }),
}));

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
}));

import * as cp from "child_process";
import * as fs from "fs";
import readline from "readline";
import * as out from "../lib/output.js";
import * as formatter from "../lib/stream-formatter.js";
import { runLoop } from "../lib/loop.js";

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

  const rlMock = {
    [Symbol.asyncIterator]: async function* () {
      for (const line of lines) yield line;
    },
  };

  vi.mocked(readline.createInterface).mockReturnValue(rlMock as any);
  vi.mocked(cp.spawn).mockReturnValue(child as any);
  return { child };
}

function mockGitBranch(branch = "main") {
  vi.mocked(cp.spawnSync)
    .mockReturnValueOnce({ stdout: branch + "\n", status: 0 } as any)
    .mockReturnValue({ stdout: "", status: 0 } as any);
}

describe("runLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.createReadStream).mockReturnValue({ pipe: vi.fn() } as any);
    vi.mocked(cp.spawnSync).mockReturnValue({ stdout: "/usr/bin/claude\n", status: 0 } as any);
  });

  it("calls output.error() and does not loop if promptFile does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit"); });
    await expect(runLoop({ promptFile: "/no/such/file.md", cwd: "/proj" })).rejects.toThrow("process.exit");
    expect(out.error).toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("calls output.error() and does not loop if claude is not in PATH", async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({ stdout: "", status: 1 } as any);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit"); });
    await expect(runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj" })).rejects.toThrow("process.exit");
    expect(out.error).toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("runs exactly max iterations then calls output.info()", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 2 });
    expect(cp.spawn).toHaveBeenCalledTimes(2);
    expect(out.info).toHaveBeenCalled();
  });

  it("calls processLine for each line and passes generator to output.stream()", async () => {
    const testLine = '{"type":"assistant","message":{"content":[]}}';
    vi.mocked(formatter.processLine).mockReturnValue({
      events: [{ type: "text", content: "→ [read] file.ts" }],
      nextState: { pendingSubagentIds: new Set(), subagentBuffers: new Map(), subagentDescriptions: new Map(), mainAgentOpen: false, lastMainCtxTotal: 0 },
    });
    makeMockChild(0, [testLine]);
    mockGitBranch("main");

    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });

    expect(formatter.processLine).toHaveBeenCalledWith(testLine, expect.any(Object));
    expect(out.stream).toHaveBeenCalledTimes(1);
  });

  it("calls output.warn() when claude exits with non-zero code", async () => {
    makeMockChild(1);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(out.warn).toHaveBeenCalledWith(expect.stringContaining("1"));
  });

  it("calls output.warn() when git push fails after retry", async () => {
    makeMockChild(0);
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any)
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)
      .mockReturnValue({ status: 1, stderr: "push failed" } as any);
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(out.warn).toHaveBeenCalled();
  });

  it("calls output.header() at startup", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(out.header).toHaveBeenCalledWith(expect.objectContaining({ mode: "implement" }));
  });

  it("retries git push with -u flag on initial failure", async () => {
    makeMockChild(0);
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any)
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)
      .mockReturnValueOnce({ status: 1, stderr: "no upstream" } as any)
      .mockReturnValueOnce({ status: 0, stderr: "" } as any);
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    const pushCalls = vi.mocked(cp.spawnSync).mock.calls.filter(
      (call) => call[0] === "git" && (call[1] as string[])[0] === "push"
    );
    expect(pushCalls).toHaveLength(2);
    expect(pushCalls[1][1]).toContain("-u");
  });

  it("warns only after retry also fails", async () => {
    makeMockChild(0);
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any)
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)
      .mockReturnValueOnce({ status: 1, stderr: "no upstream" } as any)
      .mockReturnValueOnce({ status: 1, stderr: "still failing" } as any);
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(out.warn).toHaveBeenCalledWith(expect.stringContaining("still failing"));
  });

  it("spawns claude with correct flags and cwd", async () => {
    makeMockChild(0);
    mockGitBranch("feature");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1, model: "sonnet" });
    expect(cp.spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p", "--dangerously-skip-permissions", "--output-format=stream-json", "--model", "sonnet"]),
      expect.objectContaining({ cwd: "/proj", detached: true })
    );
  });

  it("calls output.stream() once per loop iteration", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 3 });
    expect(out.stream).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run — verify tests fail**

```bash
npm test -- src/cli/tests/loop.test.ts
```

Expected: failures (loop.ts still uses Clack, and `out.header` / `out.stream` not called).

- [ ] **Step 3: Update loop.ts**

Replace all Clack imports and calls with `output.ts`. Change `sessionStream()` to `AsyncGenerator<StreamEvent>`. Key changes:

```ts
// Remove: import { intro, outro, cancel, spinner, log, note, stream } from "@clack/prompts";
import * as output from "./output.js";
import { processLine, initialState, flushState, type StreamEvent } from "./stream-formatter.js";

// Replace cancel() with output.error() + process.exit(1)
// Replace intro() with output.header({ mode: "implement", project: cwd, branch, pid: process.pid })
// Remove log.step() PID line (now in header)
// Replace outro() with output.info()
// Replace stream.message(sessionStream()) with output.stream(sessionStream())
// Replace spinner/log.warn git push with output.spinner() + output.warn()
// Replace note() with output.step()
// sessionStream() return type: AsyncGenerator<StreamEvent>
```

New `sessionStream` signature:
```ts
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
```

Git push section:
```ts
await output.spinner("git push...", async () => {
  const push = spawnSync("git", ["push", "origin", branch], { cwd, encoding: "utf8" });
  if (push.status !== 0) {
    const retry = spawnSync("git", ["push", "-u", "origin", branch], { cwd, encoding: "utf8" });
    if (retry.status !== 0) {
      throw new Error(retry.stderr ?? "unknown error");
    }
  }
});
// Note: "set upstream" distinction is lost; acceptable per spec
```

If spinner throws (both pushes fail):
```ts
try {
  await output.spinner("git push...", async () => { /* ... */ });
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  await output.warn(`git push failed: ${msg}`);
}
```

- [ ] **Step 4: Run — verify loop tests pass**

```bash
npm test -- src/cli/tests/loop.test.ts
```

Expected: all green.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/cli/lib/loop.ts src/cli/tests/loop.test.ts
git commit -m "feat: migrate loop.ts from Clack to output.ts (Ink-based)"
```

---

## Chunk 5: Command File Migrations

### Task 6: Migrate plan.ts, new.ts, meditate-create.ts

**Files:**
- Modify: `src/cli/commands/plan.ts`
- Modify: `src/cli/commands/new.ts`
- Modify: `src/cli/commands/meditate-create.ts`

All three follow the same pattern: `console.error` → `output.error()` + `process.exit(1)`, `console.log` status messages → `output.step()`. The `process.stdout/stderr.write` streaming passthrough is unchanged.

- [ ] **Step 1: Update plan.ts**

```ts
import * as output from "../lib/output.js";

// Replace:
//   console.error(`Error: project folder not found: ${absPath}`); process.exit(1);
// With:
//   await output.error(`Error: project folder not found: ${absPath}`); process.exit(1);

// Replace:
//   console.log(`Starting brainstorm session in ${absPath}...`);
// With:
//   await output.step(`Starting brainstorm session in ${absPath}...`);
// (same for other console.log calls)
```

- [ ] **Step 2: Update new.ts**

```ts
import * as output from "../lib/output.js";

// Replace:
//   console.error(`Error: directory already exists: ${targetPath}`); process.exit(1);
// With:
//   await output.error(`Error: directory already exists: ${targetPath}`); process.exit(1);

// Replace:
//   console.error(`Error: ...`); process.exit(1);  (second multi-line error block)
// With:
//   await output.error(`Error: ...`); process.exit(1);

// Replace:
//   console.log(`Creating project: ${projectName}`);
// With:
//   await output.step(`Creating project: ${projectName}`);

// Replace:
//   console.log("Initializing git repository...");
// With:
//   await output.step("Initializing git repository...");

// Replace:
//   console.error("Error: git init failed"); process.exit(1);
// With:
//   await output.error("Error: git init failed"); process.exit(1);

// Replace:
//   console.log("\nStarting project kickoff session...\n");
// With:
//   await output.step("Starting project kickoff session...");

// Replace:
//   console.log("\n\nKickoff complete. Opening interactive session...\n");
// With:
//   await output.step("Kickoff complete. Opening interactive session...");
```

- [ ] **Step 3: Build — verify no TypeScript errors after new.ts**

```bash
npm run build
```

Expected: successful build, no errors.

- [ ] **Step 4: Update meditate-create.ts**

```ts
import * as output from "../lib/output.js";

// Replace:
//   console.error(`Error: project folder not found: ${absPath}`); process.exit(1);
// With:
//   await output.error(`Error: project folder not found: ${absPath}`); process.exit(1);

// Replace:
//   console.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"); process.exit(1);
// With:
//   await output.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"); process.exit(1);

// Replace:
//   console.log(`Starting meditation session in ${absPath}...`);
// With:
//   await output.step(`Starting meditation session in ${absPath}...`);

// Replace:
//   console.log(`Reading your meditations — this may take a moment...\n`);
// With:
//   await output.step("Reading your meditations — this may take a moment...");

// Replace:
//   console.log("\n\nReady. Opening interactive session...\n");
// With:
//   await output.step("Ready. Opening interactive session...");
```

- [ ] **Step 5: Build and verify no TypeScript errors**

```bash
npm run build
```

Expected: successful build, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/plan.ts src/cli/commands/new.ts src/cli/commands/meditate-create.ts
git commit -m "feat: migrate plan, new, meditate-create commands to output.ts"
```

---

### Task 7: Migrate meditate.ts

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [ ] **Step 1: Update meditate.ts**

Replace:
- `━━━` border block → `output.header({ mode: "meditate", project: absPath, pid: process.pid })`
- `console.log("Meditation session already running...")` → `output.info(...)`
- `process.stderr.write("Warning: claude exited with code...")` → `output.warn(...)`
- All `console.error` → `output.error()` + `process.exit(1)`

Streaming passthrough (`process.stdout.write`, `process.stderr.write` for child output) unchanged.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/meditate.ts
git commit -m "feat: migrate meditate command to output.ts"
```

---

### Task 8: Migrate run-scenarios.ts (partial)

**Files:**
- Modify: `src/cli/commands/run-scenarios.ts`

Per the spec: pre-prompt output (scenario list) stays as `console.log` to avoid Ink/readline stdin conflict. Only post-selection output migrates to `output.ts`.

- [ ] **Step 1: Update run-scenarios.ts**

Keep as `console.log` (pre-prompt, before readline):
- `console.log("\nScenario tests found...")`
- `console.log("  1. scenario-name")` etc.

Migrate to `output.ts` (post-selection):
- `console.error(...)` → `output.error()` + `process.exit(1)`
- `console.log("No scenarios selected.")` → `output.info()`
- `console.log(\`\nRunning: ${scenario.name}...\`)` → `output.step(\`Running: ${scenario.name}...\`)`
- `console.log("Done: ${outPath}")` → `output.success()`

Streaming passthrough unchanged.

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/run-scenarios.ts
git commit -m "feat: partially migrate run-scenarios to output.ts (post-selection only)"
```

---

### Task 9: Migrate heartbeat subcommands (partial)

**Files:**
- Modify: `src/cli/commands/heartbeat.ts`

Per the spec: `formatTable()` stays as plain `console.log` (deferred). `heartbeat logs --follow` callback stays as `console.log` (high-frequency streaming, deferred).

- [ ] **Step 1: Update heartbeat.ts**

For each subcommand (`meditate`, `list`, `stop`, `pause`, `resume`, `kill`):
- `console.error(...)` → `output.error()` + `process.exit(1)`
- `console.log("Registered: ...")` / `"Stopped: ..."` / `"Paused: ..."` etc. → `output.success(...)`

`formatTable()`: unchanged.
`logs --follow` callback `console.log`: unchanged.

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/heartbeat.ts
git commit -m "feat: migrate heartbeat subcommand confirmations to output.ts"
```

---

## Chunk 6: Cleanup

### Task 10: Remove Clack

**Files:**
- Modify: `package.json`
- Verify: no remaining `@clack/prompts` imports

**Precondition:** All `@clack/prompts` imports must be gone from both production and test files.

- [ ] **Step 1: Remove Clack mock from loop.test.ts**

Remove the `vi.mock("@clack/prompts", ...)` block (lines ~21–56) and the `import * as clack from "@clack/prompts"` import (line ~57). These were replaced by the `output.ts` mock in Chunk 4, Task 5, Step 1.

```bash
# Verify no clack references remain in tests
grep -r "@clack/prompts" src/cli/tests/
```

Expected: no output.

- [ ] **Step 2: Verify no Clack imports remain in production code**

```bash
grep -r "@clack/prompts" src/
```

Expected: no output.

- [ ] **Step 3: Remove @clack/prompts**

```bash
npm uninstall @clack/prompts
```

- [ ] **Step 4: Build — verify no errors**

```bash
npm run build
```

Expected: success.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/cli/tests/loop.test.ts
git commit -m "chore: remove @clack/prompts — fully replaced by Ink output.ts"
```

---

## Final Smoke Test

- [ ] Link locally and run a real `ralph implement` invocation on a test project to verify visual output.

```bash
npm run build
ralph /path/to/test-project implement --max 1
```

Expected: header box, streaming agent output with colors, git push spinner, LOOP N step line.
