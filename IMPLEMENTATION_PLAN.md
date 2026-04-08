# Stream Formatter Block Ordering Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix stream-formatter so each subagent's `▶ SUBAGENT` header appears at close time (not dispatch time), `▶ MAIN AGENT` only reopens lazily when the main agent produces content, and main agent open/close markers use triple arrows (`▶▶▶` / `◀◀◀`) with a trailing blank line on close to visually separate blocks.

**Architecture:** Three targeted changes in `stream-formatter.ts`: (1) defer `▶ SUBAGENT: desc` printing from Agent dispatch to tool_result close, (2) remove the anticipatory `▶ MAIN AGENT` from the user-event handler and let the assistant-event handler open it lazily, (3) replace the single-arrow `▶`/`◀` MAIN AGENT markers with triple-arrow `▶▶▶`/`◀◀◀` and emit a blank line after every close. Tests are updated to match the new contract, plus new tests cover the parallel-subagent scenario.

**Tech Stack:** TypeScript, vitest

---

> **Status:** All tasks complete. Committed as `9fb0ab1`, tagged `0.0.27`.

## Chunk 1: Fix stream-formatter and update tests

### Task 1: Update existing tests to the new expected behavior (write failing tests first)

**Files:**
- Modify: `src/cli/tests/stream-formatter.test.ts`

The following eight tests describe the OLD behavior. Rewrite them before touching the implementation so they fail immediately and confirm coverage.

- [x] **Step 1: Update "renders text content with header and token count" test (line ~31)**

Old assertion: `expect(output).toBe("▶ MAIN AGENT\nHello world\n◈ ctx: 1,234 tokens\n")`

```typescript
it("renders text content with header and token count", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text: "Hello world" }],
      usage: { input_tokens: 1234, output_tokens: 10 },
    },
  });
  const { output } = processLine(line, initialState());
  expect(output).toBe("▶▶▶ MAIN AGENT\nHello world\n◈ ctx: 1,234 tokens\n");
});
```

- [x] **Step 2: Update "emits ▶ MAIN AGENT on first substantive main agent event" test (line ~341)**

Old assertion: `expect(output).toContain("▶ MAIN AGENT\n")`

```typescript
it("emits ▶▶▶ MAIN AGENT on first substantive main agent event", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text: "Hello" }],
      usage: { input_tokens: 100, output_tokens: 5 },
    },
  });
  const { output, nextState } = processLine(line, initialState());
  expect(output).toContain("▶▶▶ MAIN AGENT\n");
  expect(nextState.mainAgentOpen).toBe(true);
});
```

- [x] **Step 3: Update "renders Agent tool_use as SUBAGENT START" test (line ~145)**

Old assertion: `expect(output).toBe("▶ SUBAGENT: Explore auth\n")`

Replace the output assertion only — state assertions stay the same:

```typescript
it("renders Agent tool_use as SUBAGENT START and stores id, description, buffer in state", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Agent", id: "agent-1", input: { description: "Explore auth" } }],
      usage: { input_tokens: 200, output_tokens: 5 },
    },
  });
  const { output, nextState } = processLine(line, initialState());
  // ▶ SUBAGENT header is deferred to close time — no output at dispatch
  expect(output).toBe("");
  expect(nextState.pendingSubagentIds.has("agent-1")).toBe(true);
  expect(nextState.subagentDescriptions.get("agent-1")).toBe("Explore auth");
  expect(nextState.subagentBuffers.has("agent-1")).toBe(true);
  expect(nextState.mainAgentOpen).toBe(false);
});
```

- [x] **Step 4: Update "emits ◀ MAIN AGENT before ▶ SUBAGENT when main agent is open" test (line ~373)**

Old assertion: `expect(output).toBe("◀ MAIN AGENT\n▶ SUBAGENT: Do something\n")`

```typescript
it("emits ◀◀◀ MAIN AGENT when main agent is open and Agent is dispatched", () => {
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
  // Only ◀◀◀ MAIN AGENT + blank line — ▶ SUBAGENT header is deferred to close time
  expect(output).toBe("◀◀◀ MAIN AGENT\n\n");
  expect(nextState.mainAgentOpen).toBe(false);
});
```

- [x] **Step 5: Update "emits only ▶ SUBAGENT when main agent is not open" test (line ~393)**

Old assertion: `expect(output).toBe("▶ SUBAGENT: First thing\n")`

```typescript
it("produces no output when Agent is dispatched and main agent is not open", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Agent", id: "a1", input: { description: "First thing" } }],
      usage: { input_tokens: 300, output_tokens: 5 },
    },
  });
  const { output, nextState } = processLine(line, initialState());
  expect(output).toBe("");
  expect(nextState.mainAgentOpen).toBe(false);
  expect(nextState.pendingSubagentIds.has("a1")).toBe(true);
});
```

- [x] **Step 6: Update "flushes subagent buffer as labeled block on close" test (line ~182)**

Old assertion: `expect(output).toBe("  → [glob] **/*.ts\n◀ SUBAGENT\n▶ MAIN AGENT\n")`

```typescript
it("flushes subagent buffer with header at close, no anticipatory MAIN AGENT", () => {
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
  // Header printed at close time; no anticipatory ▶▶▶ MAIN AGENT
  expect(output).toBe("▶ SUBAGENT: Explore auth\n  → [glob] **/*.ts\n◀ SUBAGENT\n");
  expect(nextState.pendingSubagentIds.has("agent-1")).toBe(false);
  expect(nextState.mainAgentOpen).toBe(false);
});
```

- [x] **Step 7: Update flushState "returns buffered content + close marker" test (line ~409)**

Old assertion: `expect(output).toBe("  → [glob] **/*.ts\n◀ SUBAGENT\n")`

```typescript
it("returns header + buffered content + close marker for each pending subagent", () => {
  const state: FormatterState = {
    pendingSubagentIds: new Set(["agent-1"]),
    subagentBuffers: new Map([["agent-1", "  → [glob] **/*.ts\n"]]),
    subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
    mainAgentOpen: false,
    lastMainCtxTotal: 0,
  };
  const output = flushState(state);
  expect(output).toBe("▶ SUBAGENT: Explore auth\n  → [glob] **/*.ts\n◀ SUBAGENT\n");
});
```

- [x] **Step 8: Update flushState "closes main agent block if open" test (line ~421)**

Old assertion: `expect(flushState(state)).toBe("◀ MAIN AGENT\n")`

```typescript
it("closes main agent block if open", () => {
  const state: FormatterState = {
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainAgentOpen: true,
    lastMainCtxTotal: 0,
  };
  expect(flushState(state)).toBe("◀◀◀ MAIN AGENT\n\n");
});
```

- [x] **Step 9: Run tests to confirm the eight updated tests fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli
npm test -- --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|✓|✗|×)" | head -50
```

Expected: the eight tests above show as failing; all others pass.

---

### Task 2: Add new tests for the parallel-subagent scenario

**Files:**
- Modify: `src/cli/tests/stream-formatter.test.ts`

Add these tests after the existing suite. They will also fail until the implementation is fixed.

- [x] **Step 1: Add test — multiple parallel agents dispatch produces no output**

```typescript
it("produces no output when multiple parallel Agent calls are dispatched", () => {
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
  const { output, nextState } = processLine(line, initialState());
  expect(output).toBe("");
  expect(nextState.pendingSubagentIds.has("a1")).toBe(true);
  expect(nextState.pendingSubagentIds.has("a2")).toBe(true);
});
```

- [x] **Step 2: Add test — first subagent closes while second is still pending, no MAIN AGENT yet**

```typescript
it("does not open MAIN AGENT when first of two parallel subagents closes", () => {
  const state: FormatterState = {
    pendingSubagentIds: new Set(["a1", "a2"]),
    subagentBuffers: new Map([["a1", "  → [read] /foo.ts\n"], ["a2", ""]]),
    subagentDescriptions: new Map([["a1", "Task 1"], ["a2", "Task 2"]]),
    mainAgentOpen: false,
    lastMainCtxTotal: 0,
  };
  const line = JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "a1", content: [] }],
    },
  });
  const { output, nextState } = processLine(line, state);
  expect(output).toBe("▶ SUBAGENT: Task 1\n  → [read] /foo.ts\n◀ SUBAGENT\n");
  expect(nextState.pendingSubagentIds.has("a1")).toBe(false);
  expect(nextState.pendingSubagentIds.has("a2")).toBe(true);
  expect(nextState.mainAgentOpen).toBe(false);
});
```

- [x] **Step 3: Add test — MAIN AGENT opens lazily on next assistant event after all subagents close**

```typescript
it("MAIN AGENT opens lazily when main agent produces content after all subagents closed", () => {
  // State after both subagents have closed
  const state: FormatterState = {
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainAgentOpen: false,
    lastMainCtxTotal: 0,
  };
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text: "Done with subagents" }],
      usage: { input_tokens: 500, output_tokens: 5 },
    },
  });
  const { output, nextState } = processLine(line, state);
  expect(output).toContain("▶▶▶ MAIN AGENT\n");
  expect(output).toContain("Done with subagents\n");
  expect(nextState.mainAgentOpen).toBe(true);
});
```

- [x] **Step 4: Add end-to-end round-trip test for two parallel subagents**

```typescript
it("full round-trip: dispatch 2 parallel agents, both close, main agent continues", () => {
  let state = initialState();

  // Main agent text + dispatch two subagents
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
  const { output: o1, nextState: s1 } = processLine(dispatchLine, state);
  state = s1;
  // Main agent text shown, then closed with blank line; ctx suppressed (main agent closed before ctx gate)
  expect(o1).toBe("▶▶▶ MAIN AGENT\nRunning two tasks in parallel.\n◀◀◀ MAIN AGENT\n\n");

  // Subagent a1 tool call arrives
  const subA1Line = JSON.stringify({
    type: "assistant",
    parent_tool_use_id: "a1",
    message: {
      content: [{ type: "tool_use", name: "Read", id: "t1", input: { file_path: "/alpha.ts" } }],
      usage: { input_tokens: 100, output_tokens: 2 },
    },
  });
  const { output: o2, nextState: s2 } = processLine(subA1Line, state);
  state = s2;
  expect(o2).toBe(""); // buffered

  // Subagent a2 tool call arrives
  const subA2Line = JSON.stringify({
    type: "assistant",
    parent_tool_use_id: "a2",
    message: {
      content: [{ type: "tool_use", name: "Read", id: "t2", input: { file_path: "/beta.ts" } }],
      usage: { input_tokens: 100, output_tokens: 2 },
    },
  });
  const { output: o3, nextState: s3 } = processLine(subA2Line, state);
  state = s3;
  expect(o3).toBe(""); // buffered

  // a1 closes
  const closeA1 = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "a1", content: [] }] },
  });
  const { output: o4, nextState: s4 } = processLine(closeA1, state);
  state = s4;
  expect(o4).toBe("▶ SUBAGENT: Task Alpha\n  → [read] /alpha.ts\n◀ SUBAGENT\n");
  expect(state.mainAgentOpen).toBe(false);

  // a2 closes
  const closeA2 = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "a2", content: [] }] },
  });
  const { output: o5, nextState: s5 } = processLine(closeA2, state);
  state = s5;
  expect(o5).toBe("▶ SUBAGENT: Task Beta\n  → [read] /beta.ts\n◀ SUBAGENT\n");
  expect(state.mainAgentOpen).toBe(false);
  expect(state.pendingSubagentIds.size).toBe(0);

  // Main agent resumes
  const resumeLine = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text: "All done." }],
      usage: { input_tokens: 600, output_tokens: 5 },
    },
  });
  const { output: o6 } = processLine(resumeLine, state);
  expect(o6).toContain("▶▶▶ MAIN AGENT\n");
  expect(o6).toContain("All done.\n");
});
```

- [x] **Step 5: Run tests to confirm all new tests also fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|✓|✗|×)" | head -60
```

Expected: all twelve affected tests fail; remainder pass.

---

### Task 3: Implement the stream-formatter fix

**Files:**
- Modify: `src/cli/lib/stream-formatter.ts`

Four surgical changes. Do not touch anything else.

- [x] **Step 1: Change MAIN AGENT open marker (line ~185-188)**

Find the line `output += "▶ MAIN AGENT\n"` in the main agent assistant event handler and replace with the triple-arrow marker:

```typescript
output += "▶▶▶ MAIN AGENT\n";
```

- [x] **Step 2: Change MAIN AGENT close + remove `▶ SUBAGENT` output from Agent dispatch (lines ~197-210)**

In the `for (const block of content)` loop, find the `if (name === "Agent")` branch. Replace it so it only closes the main agent block (with triple arrows + blank line) and registers the pending subagent — no `▶ SUBAGENT` header emitted here:

```typescript
if (name === "Agent") {
  const desc = String(input.description ?? input.prompt ?? "");
  if (nextMainAgentOpen) {
    output += "◀◀◀ MAIN AGENT\n\n";
    nextMainAgentOpen = false;
  }
  // ▶ SUBAGENT header is deferred to close time
  nextPending.add(String(b.id));
  nextDescriptions.set(String(b.id), desc);
  nextBuffers.set(String(b.id), "");
}
```

- [x] **Step 3: Move `▶ SUBAGENT` header to close time in user event handler (lines ~86-96)**

Find the `tool_result` handling block inside the `event.type === "user"` branch. Replace it so the header is printed before the buffer, and no `▶▶▶ MAIN AGENT` is opened here:

```typescript
if (nextPending.has(id)) {
  const desc = nextDescriptions.get(id) ?? "";
  const buf = nextBuffers.get(id) ?? "";
  output += `▶ SUBAGENT: ${desc}\n${buf}◀ SUBAGENT\n`;
  nextPending.delete(id);
  nextBuffers.delete(id);
  nextDescriptions.delete(id);
}
```

Remove `nextMainAgentOpen = true;` that was on the line after the old output — MAIN AGENT now opens lazily via the assistant-event handler.

- [x] **Step 4: Update flushState (lines ~45-55)**

Replace the loop body and the main agent close to use triple arrows + blank line:

```typescript
export function flushState(state: FormatterState): string {
  let output = "";
  for (const id of state.pendingSubagentIds) {
    const desc = state.subagentDescriptions.get(id) ?? "";
    const buf = state.subagentBuffers.get(id) ?? "";
    output += `▶ SUBAGENT: ${desc}\n${buf}◀ SUBAGENT\n`;
  }
  if (state.mainAgentOpen) {
    output += "◀◀◀ MAIN AGENT\n\n";
  }
  return output;
}
```

---

### Task 4: Verify and commit

**Files:**
- No new files

- [x] **Step 1: Run the full test suite**

```bash
npm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass. If any fail, read the error, trace it back to the relevant change, and fix.

- [x] **Step 2: Build to catch type errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: `dist/` updated, no TypeScript errors.

- [x] **Step 3: Commit**

```bash
git add src/cli/lib/stream-formatter.ts src/cli/tests/stream-formatter.test.ts
git commit -m "fix: triple-arrow main agent markers, defer subagent header to close time, lazy MAIN AGENT open"
```
