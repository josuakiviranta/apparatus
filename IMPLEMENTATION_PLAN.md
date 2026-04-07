# Implementation Plan: Stream Formatter Redesign

**Date:** 2026-04-07
**Spec:** `docs/superpowers/specs/2026-04-07-stream-formatter-redesign.md`

## Architecture

`src/cli/lib/stream-formatter.ts` is a pure functional module: `processLine(line, state) → { output, nextState }`. No side effects, no I/O. Wired into `loop.ts` via readline, which calls `flushState` after the stream closes.

## Tech Stack

TypeScript, vitest, Node.js readline. No new dependencies.

---

## Chunk 1 — Fix FormatterState and initialState

### Task 1: Update FormatterState interface and initialState

**File:** `src/cli/lib/stream-formatter.ts`

Replace the current `FormatterState` interface and `initialState` function:

```ts
export interface FormatterState {
  pendingSubagentIds: Set<string>;
  subagentBuffers: Map<string, string>;      // parent_tool_use_id → accumulated indented lines
  subagentDescriptions: Map<string, string>; // parent_tool_use_id → description for block header
  mainHeaderPrinted: boolean;
  lastMainCtxTotal: number;
}

export function initialState(): FormatterState {
  return {
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainHeaderPrinted: false,
    lastMainCtxTotal: 0,
  };
}
```

- [ ] **Confirm `inSubagent` is absent:** `grep -n "inSubagent" src/cli/lib/stream-formatter.ts` — expected: no matches.

**Tests to update in `stream-formatter.test.ts`:**

Every test that constructs a `FormatterState` literal directly (not via `initialState()`) must add the two new maps and `lastMainCtxTotal`. Current fixtures needing update:

- `"emits SUBAGENT DONE when tool_result matches pending id"` — state literal needs `subagentBuffers`, `subagentDescriptions`, `lastMainCtxTotal`
- `"ignores tool_result for non-subagent ids"` — same
- `"closes pending subagents on next assistant turn"` — same
- `"does not repeat header on consecutive assistant events"` — same

Pattern for each fix:
```ts
const state: FormatterState = {
  pendingSubagentIds: new Set([...]),
  subagentBuffers: new Map(),
  subagentDescriptions: new Map(),
  mainHeaderPrinted: ...,
  lastMainCtxTotal: 0,
};
```

**Verification:** `npm test` passes with no type errors.

---

## Chunk 2 — Buffering and labeled block output

### Task 2: Extract `formatSubagentBlock` helper

**File:** `src/cli/lib/stream-formatter.ts`

- [ ] **Add the helper function** at module level (before `processLine`), so both `processLine` and `flushState` can call it:

  ```ts
  function formatSubagentBlock(desc: string, buf: string): string {
    const label = `┌─ SUBAGENT: ${desc} `;
    const totalWidth = 56;
    const dashes = "─".repeat(Math.max(0, totalWidth - label.length));
    return `\n${label}${dashes}\n${buf}◀ ${"─".repeat(totalWidth - 2)}\n\n`;
  }
  ```

- [ ] **Add unit tests** in `stream-formatter.test.ts` (import the function — it will need to be exported temporarily for testing, or tested via its callers; prefer testing via processLine/flushState):

  ```ts
  it("formatSubagentBlock: normal description produces correct framing", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["a1"]),
      subagentBuffers: new Map([["a1", "  → [glob] **/*.ts\n"]]),
      subagentDescriptions: new Map([["a1", "Study specs"]]),
      mainHeaderPrinted: true,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a1", content: [] }] } });
    const { output } = processLine(line, state);
    expect(output).toContain("┌─ SUBAGENT: Study specs ");
    expect(output).toContain("◀ ──");
    expect(output).toContain("  → [glob] **/*.ts");
  });

  it("formatSubagentBlock: long description clamps dashes to zero", () => {
    const longDesc = "A".repeat(60); // label alone exceeds totalWidth=56
    const state: FormatterState = {
      pendingSubagentIds: new Set(["a1"]),
      subagentBuffers: new Map([["a1", ""]]),
      subagentDescriptions: new Map([["a1", longDesc]]),
      mainHeaderPrinted: true,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a1", content: [] }] } });
    const { output } = processLine(line, state);
    // Should not throw and should still contain the description
    expect(output).toContain(`┌─ SUBAGENT: ${longDesc}`);
  });
  ```

- [ ] **Run tests:**

  ```bash
  cd /Users/josu/Documents/projects/ralph-cli && npm test -- --reporter=verbose 2>&1 | tail -20
  ```

  Expected: new tests pass.

### Task 3: Update Agent tool_use dispatch (main agent turn)

**File:** `src/cli/lib/stream-formatter.ts`

- [ ] **At the top of the main-agent assistant branch**, initialize mutable copies of both new maps alongside `nextPending`:

  ```ts
  const nextBuffers = new Map(state.subagentBuffers);
  const nextDescriptions = new Map(state.subagentDescriptions);
  ```

- [ ] **In the `name === "Agent"` branch**, also store the description and initialize the buffer:

  ```ts
  if (name === "Agent") {
    const desc = String(input.description ?? input.prompt ?? "");
    output += `▶ SUBAGENT: ${desc}\n`;
    nextPending.add(String(b.id));
    nextDescriptions.set(String(b.id), desc);
    nextBuffers.set(String(b.id), "");
  }
  ```

- [ ] **Update the return value** of the main-agent branch to include the new maps:

  ```ts
  return {
    output,
    nextState: {
      pendingSubagentIds: nextPending,
      subagentBuffers: nextBuffers,
      subagentDescriptions: nextDescriptions,
      mainHeaderPrinted: nextHeaderPrinted,
      lastMainCtxTotal: nextLastMainCtxTotal,
    },
  };
  ```

- [ ] **Verify with test:** the existing `"renders Agent tool_use as SUBAGENT START and stores the id in state"` test must also assert the description and buffer were stored:

  ```ts
  expect(nextState.subagentDescriptions.get("agent-1")).toBe("Explore auth");
  expect(nextState.subagentBuffers.has("agent-1")).toBe(true);
  ```

- [ ] **Run tests:**

  ```bash
  cd /Users/josu/Documents/projects/ralph-cli && npm test -- --reporter=verbose 2>&1 | tail -20
  ```

  Expected: all tests pass.

### Task 4: Buffer subagent assistant events (parent_tool_use_id present)

**File:** `src/cli/lib/stream-formatter.ts`

Replace the current implicit-close + immediate-render logic for subagent events. When `event.type === "assistant"` and `parentToolUseId` is set, append to the buffer instead of printing:

```ts
if (parentToolUseId) {
  const hasContent = content.some((b) => {
    const block = b as Record<string, unknown>;
    return (
      block.type === "tool_use" ||
      (block.type === "text" && String(block.text ?? "").trim().length > 0)
    );
  });
  if (!hasContent) return { output: "", nextState: state };

  const nextBuffers = new Map(state.subagentBuffers);
  let buf = nextBuffers.get(parentToolUseId) ?? "";
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text") {
      buf += "  " + String(b.text) + "\n";
    } else if (b.type === "tool_use") {
      const name = String(b.name);
      const input = (b.input ?? {}) as Record<string, unknown>;
      buf += "  " + formatToolUse(name, input);
    }
  }
  nextBuffers.set(parentToolUseId, buf);
  return {
    output: "",
    nextState: { ...state, subagentBuffers: nextBuffers },
  };
}
```

No ctx line, no header for subagent events.

**Remove the implicit-close block** (`if (nextPending.size > 0) { ... }`) entirely — it is replaced by buffering + explicit close.

**Tests — replace old test with new:**

Delete: `"closes pending subagents on next assistant turn"` (implicit close is removed).

Add:
```ts
it("buffers subagent assistant event, no immediate output", () => {
  const state: FormatterState = {
    pendingSubagentIds: new Set(["agent-1"]),
    subagentBuffers: new Map([["agent-1", ""]]),
    subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
    mainHeaderPrinted: true,
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
  const { output, nextState } = processLine(line, state);
  expect(output).toBe("");
  expect(nextState.subagentBuffers.get("agent-1")).toBe("  → [glob] **/*.ts\n");
});
```

### Task 5: Flush buffer as labeled block on subagent close

**File:** `src/cli/lib/stream-formatter.ts`

Replace the current `event.type === "tool_result"` check (which never fires) with the correct `user`-wrapped shape:

```ts
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
```

**Tests — replace old close test with new:**

Delete: `"emits SUBAGENT DONE when tool_result matches pending id"` (old event shape, old output).

Add:
```ts
it("flushes subagent buffer as labeled block on close", () => {
  const state: FormatterState = {
    pendingSubagentIds: new Set(["agent-1"]),
    subagentBuffers: new Map([["agent-1", "  → [glob] **/*.ts\n"]]),
    subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
    mainHeaderPrinted: true,
    lastMainCtxTotal: 0,
  };
  const line = JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "agent-1", content: [] }],
    },
  });
  const { output, nextState } = processLine(line, state);
  expect(output).toContain("┌─ SUBAGENT: Explore auth");
  expect(output).toContain("  → [glob] **/*.ts");
  expect(output).toContain("◀ ──");
  expect(nextState.pendingSubagentIds.has("agent-1")).toBe(false);
  expect(nextState.mainHeaderPrinted).toBe(false);
});
```

Also update: `"ignores tool_result for non-subagent ids"` — change event shape to `user`-wrapped:
```ts
const line = JSON.stringify({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: "some-other-id", content: "ok" }] },
});
```

---

## Chunk 3 — ctx growth gating

### Task 6: Gate ctx line on `lastMainCtxTotal`

**File:** `src/cli/lib/stream-formatter.ts`

In the main-agent assistant event handler, replace the unconditional ctx print:

```ts
if (typeof usage?.input_tokens === "number") {
  const total =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  if (total > state.lastMainCtxTotal) {
    output += `◈ ctx: ${total.toLocaleString("en-US")} tokens\n`;
    nextLastMainCtxTotal = total;
  }
}
```

`nextLastMainCtxTotal` is declared at top of the main-agent branch, initialized to `state.lastMainCtxTotal`, and included in the returned `nextState`.

Subagent events (handled in Task 4 branch) never print a ctx line — already ensured by early return.

**Tests to add:**

```ts
it("prints ctx line when total grows, suppresses when equal", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 1000, output_tokens: 5 },
    },
  });
  // First call from initialState: 1000 > 0 → prints
  const { output: o1, nextState: s1 } = processLine(line, initialState());
  expect(o1).toContain("◈ ctx: 1,000 tokens");
  expect(s1.lastMainCtxTotal).toBe(1000);

  // Second call: 1000 is not > 1000 → suppressed
  const { output: o2 } = processLine(line, s1);
  expect(o2).not.toContain("◈ ctx");
});

it("suppresses ctx line when total has not grown", () => {
  const state: FormatterState = {
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainHeaderPrinted: false,
    lastMainCtxTotal: 5000,
  };
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text: "same size" }],
      usage: { input_tokens: 5000, output_tokens: 5 },
    },
  });
  const { output } = processLine(line, state);
  expect(output).not.toContain("◈ ctx");
});

it("never prints ctx line for subagent assistant events", () => {
  const state: FormatterState = {
    pendingSubagentIds: new Set(["agent-1"]),
    subagentBuffers: new Map([["agent-1", ""]]),
    subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
    mainHeaderPrinted: true,
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
  const { output } = processLine(line, state);
  expect(output).toBe(""); // buffered, not printed — no ctx line emitted
});
```

Existing tests that assert `◈ ctx: N tokens` on first call from `initialState()` still pass because `lastMainCtxTotal` starts at 0 and any positive total is greater.

Existing test `"sums cache tokens into ctx total"` still passes for the same reason.

---

## Chunk 4 — flushState

### Task 7: Update flushState to use formatSubagentBlock

**File:** `src/cli/lib/stream-formatter.ts`

```ts
export function flushState(state: FormatterState): string {
  let output = "";
  for (const id of state.pendingSubagentIds) {
    const desc = state.subagentDescriptions.get(id) ?? "";
    const buf = state.subagentBuffers.get(id) ?? "";
    output += formatSubagentBlock(desc, buf);
  }
  return output;
}
```

**Tests to update:**

Replace old `flushState` tests (which expected `◀ SUBAGENT DONE\n` per pending ID) with:

```ts
it("flushState returns formatted block for each pending subagent", () => {
  const state: FormatterState = {
    pendingSubagentIds: new Set(["agent-1"]),
    subagentBuffers: new Map([["agent-1", "  → [glob] **/*.ts\n"]]),
    subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
    mainHeaderPrinted: true,
    lastMainCtxTotal: 0,
  };
  const output = flushState(state);
  expect(output).toContain("┌─ SUBAGENT: Explore auth");
  expect(output).toContain("  → [glob] **/*.ts");
  expect(output).toContain("◀ ──");
});

it("flushState returns empty string when no pending subagents", () => {
  expect(flushState(initialState())).toBe("");
});
```

---

## Chunk 5 — loop.ts wiring

### Task 8: Wire flushState in loop.ts

**File:** `src/cli/lib/loop.ts`

- [ ] **Read loop.ts** in full before editing.

- [ ] **Update the import** to include `flushState`:

  ```ts
  import { processLine, initialState, flushState } from "./stream-formatter.js";
  ```

- [ ] **Add flush call** after `await new Promise<void>((resolve) => rl.on("close", resolve));`:

  ```ts
  const flush = flushState(state);
  if (flush) process.stdout.write(flush);
  ```

- [ ] **Build to verify no TypeScript errors:**

  ```bash
  cd /Users/josu/Documents/projects/ralph-cli && npm run build 2>&1 | tail -10
  ```

  Expected: build succeeds with no errors.

- [ ] **Commit:**

  ```bash
  git add src/cli/lib/loop.ts
  git commit -m "feat: call flushState after readline close in loop.ts"
  ```

---

## Chunk 6 — Scenario test

### Task 9: Update scenario test

**File:** `scenario-tests/test-stream-formatter.sh`

**INPUT changes:**

1. Keep the initial assistant event (main agent: text + Read + Agent dispatch).
2. Add a subagent assistant event between the Agent dispatch and the close:
   ```json
   {"type":"assistant","parent_tool_use_id":"a1","message":{"content":[{"type":"tool_use","name":"Glob","id":"t2","input":{"pattern":"**/*.ts"}}],"usage":{"input_tokens":300,"output_tokens":5}}}
   ```
3. Change the close event from `{"type":"tool_result",...}` to the correct user-wrapped shape:
   ```json
   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"a1","content":[]}]}}
   ```
4. Keep the second assistant event (Bash + ctx growth).

**Assertion changes:**

Remove:
```bash
check "◀ SUBAGENT DONE"
```

Add:
```bash
check "┌─ SUBAGENT: Explore auth patterns"
check "  → [glob] **/*.ts"
check "◀ ──"
```

Keep all other assertions unchanged:
```bash
check "┌─ MAIN AGENT"
check "Analyzing codebase..."
check "→ [read] /src/foo.ts"
check "▶ SUBAGENT: Explore auth patterns"
check "◈ ctx: 5,000 tokens"
check "→ [bash] npm test"
check "◈ ctx: 5,200 tokens"
```

Note: `◈ ctx: 5,200 tokens` asserts ctx growth gating works (5200 > 5000). The subagent event (300 tokens) must not print a ctx line.

---

## Verification Checklist

After all chunks:

1. `npm test` — all unit tests pass
2. `npm run build` — compiles without TypeScript errors
3. `bash scenario-tests/test-stream-formatter.sh` — scenario PASS
4. Manual smoke: pipe a real Claude Code stream-json file through the built formatter; confirm subagent blocks appear as labeled sections, not interleaved lines
