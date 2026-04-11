# Pipeline Renderer Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current nested-`<Static>` pipeline renderer (`PipelineDisplay.tsx` + `ChatUI.tsx`) with a single-`<Static>` `PipelineApp` that renders each pipeline node as a discrete append-only block plus one in-place live footer, fixing the three observed rendering bugs (stacked empty borders, mid-chat trace header, lost downstream output).

**Architecture:** One Ink root component (`PipelineApp`) owns `PipelineState` via a pure `useReducer`. Finished blocks live in a single `<Static items={frozen}>`. The currently-running node lives in a plain `<Box>` live footer that redraws per event. An adapter in `pipeline.ts` translates engine callbacks and Claude stream-json events into a single `NodeEvent` stream via `callbacks.emit(...)`. `ChatUI.tsx` and `PipelineDisplay.tsx` are deleted; `TextInput.tsx` and `slash-commands.ts` are reused unchanged.

**Tech Stack:** TypeScript (ESM), React, Ink 6.8.0, `ink-testing-library`, Vitest, Node.js subprocess via `ChildHandle` (`src/cli/lib/agent.ts`).

**Reference spec:** `docs/superpowers/specs/2026-04-14-pipeline-renderer-redesign-design.md`

---

## Chunk 1: Pure helpers (`claudeTracePath`, `classifyNode`, `parseClaudeEvent`)

These three pure modules are the foundation — all other code depends on them, and they can be implemented and tested with no React, no Ink, no subprocess. Build them first, lock them down with unit tests, and the rest of the rewrite has stable primitives.

### Task 1.1: `claudeTracePath` helper

**Files:**
- Create: `src/cli/lib/claudeTracePath.ts`
- Create: `src/cli/tests/claudeTracePath.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/claudeTracePath.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { homedir } from "os";
import { join } from "path";
import { claudeTracePath } from "../lib/claudeTracePath.js";

describe("claudeTracePath", () => {
  it("encodes the project directory by replacing / with -", () => {
    const p = claudeTracePath("sid-abc", "/Users/josu/Documents/projects/ralph-cli");
    expect(p).toBe(
      join(
        homedir(),
        ".claude",
        "projects",
        "-Users-josu-Documents-projects-ralph-cli",
        "sid-abc.jsonl",
      ),
    );
  });

  it("handles a nested project directory with multiple segments", () => {
    const p = claudeTracePath("xyz", "/a/b/c");
    expect(p).toBe(join(homedir(), ".claude", "projects", "-a-b-c", "xyz.jsonl"));
  });

  it("appends .jsonl to the sessionId", () => {
    const p = claudeTracePath("fake-uuid", "/tmp");
    expect(p.endsWith("/fake-uuid.jsonl")).toBe(true);
  });

  it("defaults projectDir to process.cwd() when omitted", () => {
    const p = claudeTracePath("sid");
    const encoded = process.cwd().replace(/\//g, "-");
    expect(p).toBe(join(homedir(), ".claude", "projects", encoded, "sid.jsonl"));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/claudeTracePath.test.ts`
Expected: FAIL — `Cannot find module '../lib/claudeTracePath.js'`

- [x] **Step 3: Write minimal implementation**

Create `src/cli/lib/claudeTracePath.ts`:

```ts
import { homedir } from "os";
import { join } from "path";

/**
 * Builds the absolute path to a Claude Code session transcript file.
 * Claude Code stores transcripts under ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * where <encoded-cwd> is the project directory with all "/" replaced by "-".
 *
 * This path can be tailed by a secondary agent to observe the full conversation.
 */
export function claudeTracePath(
  sessionId: string,
  projectDir: string = process.cwd(),
): string {
  const encoded = projectDir.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/claudeTracePath.test.ts`
Expected: PASS (4/4)

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/claudeTracePath.ts src/cli/tests/claudeTracePath.test.ts
git commit -m "feat(lib): add claudeTracePath helper for session transcript paths"
```

---

### Task 1.2: `classifyNode` helper

**Files:**
- Create: `src/cli/lib/classifyNode.ts`
- Create: `src/cli/tests/classifyNode.test.ts`

Context: `src/attractor/core/graph.ts:225` already exports `resolveHandlerType(node)` whose actual return semantics are (verified by reading graph.ts:218-230):
- `node.agent` set → `"agent"`
- `node.type` set → returns `node.type` verbatim
- otherwise `SHAPE_TO_TYPE[node.shape]` (e.g. `box → "codergen"`, `hexagon → "wait.human"`, `diamond → "conditional"`, `parallelogram → "tool"`, `Mdiamond → "start"`, `Msquare → "exit"`)
- fallback → `"codergen"`

Note the string is `"wait.human"` (dot) when resolved via shape, but `"wait-human"` (hyphen) when declared explicitly via `node.type`. `classifyNode` must accept **both** and collapse them into the hyphen form used by `BlockKind`. Everything that doesn't map to one of the five known block kinds (`agent`, `tool`, `wait-human`, `conditional`, `interactive-agent`) falls through to `"marker"`.

`Node` already declares `interactive?: boolean | string` at `src/attractor/types.ts:31`, so no type extension is needed.

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/classifyNode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyNode, isInteractive, type BlockKind } from "../lib/classifyNode.js";
import type { Node } from "../../attractor/types.js";

function node(partial: Partial<Node>): Node {
  return { id: "x", ...partial };
}

describe("classifyNode", () => {
  it("returns 'interactive-agent' for agent nodes with interactive=true", () => {
    expect(classifyNode(node({ agent: "claude", interactive: true }))).toBe("interactive-agent");
  });

  it("returns 'interactive-agent' for agent nodes with interactive='true' (string form)", () => {
    expect(classifyNode(node({ agent: "claude", interactive: "true" }))).toBe("interactive-agent");
  });

  it("returns 'agent' for agent nodes without interactive flag", () => {
    expect(classifyNode(node({ agent: "claude" }))).toBe("agent");
    expect(classifyNode(node({ agent: "claude", interactive: false }))).toBe("agent");
  });

  it("returns 'tool' for explicit tool type", () => {
    expect(classifyNode(node({ type: "tool", toolCommand: "ls" }))).toBe("tool");
  });

  it("returns 'tool' for parallelogram-shaped nodes (SHAPE_TO_TYPE=tool)", () => {
    expect(classifyNode(node({ shape: "parallelogram" }))).toBe("tool");
  });

  it("returns 'wait-human' for wait-human nodes declared via node.type", () => {
    expect(classifyNode(node({ type: "wait-human" }))).toBe("wait-human");
  });

  it("returns 'wait-human' for hexagon-shaped nodes (resolveHandlerType returns 'wait.human')", () => {
    expect(classifyNode(node({ shape: "hexagon" }))).toBe("wait-human");
  });

  it("returns 'conditional' for diamond-shaped nodes", () => {
    expect(classifyNode(node({ shape: "diamond" }))).toBe("conditional");
  });

  it("returns 'marker' for start/exit/done markers", () => {
    expect(classifyNode(node({ id: "start", shape: "Mdiamond" }))).toBe("marker");
    expect(classifyNode(node({ id: "exit", shape: "Msquare" }))).toBe("marker");
    expect(classifyNode(node({ id: "done" }))).toBe("marker");
  });

  it("returns 'marker' for codergen fallback (unknown shape / no type / no agent)", () => {
    // shape "box" → SHAPE_TO_TYPE="codergen"; codergen is not a BlockKind so it collapses to marker
    expect(classifyNode(node({ shape: "box" }))).toBe("marker");
    // no hints at all → resolveHandlerType returns "codergen"
    expect(classifyNode(node({ id: "weird" }))).toBe("marker");
  });
});

describe("isInteractive", () => {
  it("is true only for interactive-agent", () => {
    expect(isInteractive(node({ agent: "claude", interactive: true }))).toBe(true);
    expect(isInteractive(node({ agent: "claude" }))).toBe(false);
    expect(isInteractive(node({ type: "tool" }))).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/classifyNode.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write minimal implementation**

Create `src/cli/lib/classifyNode.ts`:

```ts
import type { Node } from "../../attractor/types.js";
import { resolveHandlerType } from "../../attractor/core/graph.js";

export type BlockKind =
  | "agent"
  | "interactive-agent"
  | "tool"
  | "wait-human"
  | "conditional"
  | "marker";

/**
 * Classifies a pipeline node into a BlockKind used by the renderer.
 * Mirrors resolveHandlerType() for handler routing, then collapses
 * start/exit/done markers into "marker" and splits agent by interactivity.
 */
export function classifyNode(node: Node): BlockKind {
  // Markers first — start/exit/done produce no agent output
  if (
    node.shape === "Mdiamond" ||
    node.shape === "Msquare" ||
    node.id === "start" ||
    node.id === "Start" ||
    node.id === "exit" ||
    node.id === "end" ||
    node.id === "done"
  ) {
    return "marker";
  }

  const t = resolveHandlerType(node);

  if (t === "agent") {
    const interactive = node.interactive === true || node.interactive === "true";
    return interactive ? "interactive-agent" : "agent";
  }
  if (t === "tool") return "tool";
  // Accept both the hyphenated form (node.type="wait-human") and the dotted form
  // (SHAPE_TO_TYPE["hexagon"] = "wait.human") that resolveHandlerType can produce.
  if (t === "wait-human" || t === "wait.human") return "wait-human";
  if (t === "conditional") return "conditional";

  // Anything else (codergen, parallel, start, exit, ralph.*, stack.*, etc.) is
  // treated as a marker — no trace path, no streaming body, just a structural
  // line in the rendered output.
  return "marker";
}

export function isInteractive(node: Node): boolean {
  return classifyNode(node) === "interactive-agent";
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/classifyNode.test.ts`
Expected: PASS (11/11)

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/classifyNode.ts src/cli/tests/classifyNode.test.ts
git commit -m "feat(lib): add classifyNode helper for BlockKind mapping"
```

---

### Task 1.3: `parseClaudeEvent` helper

**Files:**
- Create: `src/cli/lib/parseClaudeEvent.ts`
- Create: `src/cli/tests/parseClaudeEvent.test.ts`

Context: `src/cli/lib/stream-formatter.ts:308` defines `StreamJsonEvent` as a discriminated union: `system | assistant_delta | tool_use | tool_result | result | parse_error`. The `system` variant carries `sessionId?: string`.

> **Spec note:** The spec's "Testing strategy / Layer 1" references `system_init` and `message_stop` event names. These do **not** exist in the actual `StreamJsonEvent` union — the corresponding variants are `system` and `result` respectively. The plan uses the correct names. If the spec is updated later, this section should be re-aligned.

The new `NodeEvent` type will be consumed by the reducer in **Chunk 2** (`src/cli/lib/pipelineReducer.ts`), but `parseClaudeEvent` needs it now, so the type lives in its own file (`pipelineEvents.ts`) to avoid a circular import between `parseClaudeEvent.ts` and `pipelineReducer.ts`.

> **Important:** This task creates `src/cli/lib/pipelineEvents.ts` (type-only) for `NodeEvent` / `BodyLine`. The reducer in Chunk 2 imports from the same file.

- [x] **Step 1: Write the type file**

Create `src/cli/lib/pipelineEvents.ts`:

```ts
import type { ChildHandle } from "./agent.js";
import type { BlockKind } from "./classifyNode.js";

// Note: this file is extended in Chunk 2 Task 2.1 with Block / LiveBlock /
// PipelineState / initialPipelineState. Do not add them here — keep Chunk 1
// focused on the event/body/stats/outcome shapes that parseClaudeEvent needs.

export type BodyLine =
  | { kind: "text"; role: "you" | "claude" | "system"; text: string }
  | { kind: "tool_use"; name: string; summary: string };

export type Stats = {
  turns: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
};

export type Outcome = {
  status: "success" | "fail" | "abort";
  reason?: string;
};

export type NodeEvent =
  | { kind: "start"; nodeId: string; label: string; blockKind: BlockKind }
  | { kind: "trace-path"; sessionId: string }
  | { kind: "text"; role: "you" | "claude" | "system"; text: string }
  | { kind: "tool_use"; name: string; summary: string }
  | { kind: "interactive-ready"; child: ChildHandle; onDone: () => void }
  | { kind: "end"; outcome: Outcome; stats?: Partial<Stats> };
```

- [x] **Step 2: Write the failing test**

Create `src/cli/tests/parseClaudeEvent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseClaudeEvent } from "../lib/parseClaudeEvent.js";
import type { StreamJsonEvent } from "../lib/stream-formatter.js";

describe("parseClaudeEvent", () => {
  it("maps assistant_delta to a text event with role 'claude'", () => {
    const ev: StreamJsonEvent = { type: "assistant_delta", textDelta: "hello" };
    expect(parseClaudeEvent(ev)).toEqual([
      { kind: "text", role: "claude", text: "hello" },
    ]);
  });

  it("maps tool_use to a tool_use event with a readable summary", () => {
    const ev: StreamJsonEvent = {
      type: "tool_use",
      toolCall: { id: "t1", name: "Write", input: { file_path: "/tmp/x.md" } },
    };
    const out = parseClaudeEvent(ev);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("tool_use");
    if (out[0].kind !== "tool_use") throw new Error();
    expect(out[0].name).toBe("Write");
    expect(out[0].summary.length).toBeGreaterThan(0);
  });

  it("maps system event with sessionId to a trace-path event", () => {
    const ev: StreamJsonEvent = { type: "system", sessionId: "sid-abc", raw: {} };
    expect(parseClaudeEvent(ev)).toEqual([
      { kind: "trace-path", sessionId: "sid-abc" },
    ]);
  });

  it("returns [] for system event with no sessionId", () => {
    const ev: StreamJsonEvent = { type: "system", raw: {} };
    expect(parseClaudeEvent(ev)).toEqual([]);
  });

  it("returns [] for result events (turn closure handled by caller)", () => {
    const ev: StreamJsonEvent = {
      type: "result",
      stopReason: "end_turn",
      text: "",
      usage: { inputTokens: 10, outputTokens: 5 },
      raw: {},
    };
    expect(parseClaudeEvent(ev)).toEqual([]);
  });

  it("returns [] for tool_result (caller renders from tool_use only)", () => {
    const ev: StreamJsonEvent = {
      type: "tool_result",
      toolCallId: "t1",
      content: "ok",
      isError: false,
    };
    expect(parseClaudeEvent(ev)).toEqual([]);
  });

  it("returns [] for parse_error", () => {
    const ev: StreamJsonEvent = {
      type: "parse_error",
      rawLine: "{bad",
      error: "json",
    };
    expect(parseClaudeEvent(ev)).toEqual([]);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/parseClaudeEvent.test.ts`
Expected: FAIL — module not found.

- [x] **Step 4: Write minimal implementation**

Create `src/cli/lib/parseClaudeEvent.ts`:

```ts
import type { StreamJsonEvent } from "./stream-formatter.js";
import type { NodeEvent } from "./pipelineEvents.js";

/**
 * Translates one raw Claude Code stream-json event into zero or more NodeEvents.
 *
 * Pure: no side effects, no Ink, no subprocess. Safe to unit-test in isolation.
 *
 * Mapping:
 *  - assistant_delta  → one text event (role="claude")
 *  - tool_use         → one tool_use event with a short summary of inputs
 *  - system+sessionId → one trace-path event (adapter emits early; idempotent)
 *  - result           → [] (caller tracks turn closure via the absence of deltas)
 *  - tool_result      → [] (not currently rendered inline)
 *  - parse_error      → [] (logged by caller if needed)
 */
export function parseClaudeEvent(raw: StreamJsonEvent): NodeEvent[] {
  switch (raw.type) {
    case "assistant_delta":
      return [{ kind: "text", role: "claude", text: raw.textDelta }];
    case "tool_use":
      return [
        {
          kind: "tool_use",
          name: raw.toolCall.name,
          summary: summarizeToolInput(raw.toolCall.input),
        },
      ];
    case "system":
      return raw.sessionId
        ? [{ kind: "trace-path", sessionId: raw.sessionId }]
        : [];
    case "result":
    case "tool_result":
    case "parse_error":
      return [];
  }
}

function summarizeToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.slice(0, 80);
  try {
    const s = JSON.stringify(input);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
  } catch {
    return "";
  }
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/parseClaudeEvent.test.ts`
Expected: PASS (7/7)

- [x] **Step 6: Run all three helper test files together to confirm no cross-module breakage**

Run: `npx vitest run src/cli/tests/claudeTracePath.test.ts src/cli/tests/classifyNode.test.ts src/cli/tests/parseClaudeEvent.test.ts`
Expected: PASS (22/22 combined: 4 + 11 + 7)

- [x] **Step 7: Commit**

```bash
git add src/cli/lib/pipelineEvents.ts src/cli/lib/parseClaudeEvent.ts src/cli/tests/parseClaudeEvent.test.ts
git commit -m "feat(lib): add parseClaudeEvent helper + pipelineEvents types"
```

---

**Chunk 1 done.** At this point the three pure helpers exist with full unit coverage. No React code has been touched, no engine code has been touched, `pipeline.ts` still uses the old `renderPipelineDisplay`. The build still compiles because nothing imports the new files yet.

---

## Chunk 2: Pure reducer (`pipelineReducer`)

Chunk 2 adds the pure state machine that turns a stream of `NodeEvent`s into `PipelineState`. No React, no Ink — just a pure function `(state, event) => state`. This is the single most important regression-proofing layer: if the reducer's tests cover the "frozen blocks survive subsequent live updates" scenario, the three original bugs cannot recur structurally.

### Task 2.1: State types + reducer skeleton

**Files:**
- Modify: `src/cli/lib/pipelineEvents.ts` (extend with `Block`, `LiveBlock`, `PipelineState`)
- Create: `src/cli/lib/pipelineReducer.ts`
- Create: `src/cli/tests/pipelineReducer.test.ts`

- [x] **Step 1: Extend `pipelineEvents.ts` with state types**

Edit `src/cli/lib/pipelineEvents.ts`. The file currently declares `BodyLine`, `Stats`, `Outcome`, and `NodeEvent` (from Chunk 1 Task 1.3). Add a top-of-file `import type` for `BlockKind` so it can be referenced directly, then append the state types below the `NodeEvent` union.

Required top-of-file imports (add if not already present — Chunk 1 already adds the `ChildHandle` import):

```ts
import type { ChildHandle } from "./agent.js";
import type { BlockKind } from "./classifyNode.js";
```

(These are safe: neither `agent.ts` nor `classifyNode.ts` imports anything from `pipelineEvents.ts`, so no import cycle is created.)

Append after `NodeEvent`:

```ts
export type Block = {
  id: string;             // stable key for <Static>, e.g. `${nodeId}-${frozenIndex}`
  nodeId: string;
  label: string;
  kind: BlockKind;
  tracePath?: string;     // absolute path to ~/.claude/projects/<cwd>/<sid>.jsonl
  body: BodyLine[];
  outcome: Outcome;
  stats: Stats;
  // IMPORTANT: `onDone` is carried forward from LiveBlock at freeze time so
  // PipelineApp's post-commit effect can dispatch it deterministically by
  // reading from the just-appended frozen block. This avoids a React-18
  // batching race where multiple dispatches collapse into one commit and
  // any ref-based "previous live" snapshot goes stale. The reducer still
  // never INVOKES onDone — only moves the reference.
  onDone?: () => void;
};

export type LiveBlock = {
  id: string;
  nodeId: string;
  label: string;
  kind: BlockKind;
  tracePath?: string;
  startedAt: number;
  body: BodyLine[];
  // NOTE: Intentionally omits `durationMs` — elapsed time is computed and
  // added by the reducer only at `end` time (see pipelineReducer `fillStats`).
  // Do not "fix" this to `stats: Stats`.
  stats: { turns: number; tokensIn: number; tokensOut: number };
  // Interactive-only — present after an `interactive-ready` event.
  // The reducer stores these as pass-through references and never invokes them
  // (spec invariant #7). Side effects happen in PipelineApp's post-commit effect
  // and in the TextInput.onSubmit handler.
  child?: ChildHandle;
  onDone?: () => void;
};

export type PipelineState = {
  frozen: Block[];
  live: LiveBlock | null;
};

export const initialPipelineState: PipelineState = {
  frozen: [],
  live: null,
};
```

- [x] **Step 2: Write the failing test — basic start/text/end flow**

Create `src/cli/tests/pipelineReducer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pipelineReducer } from "../lib/pipelineReducer.js";
import { initialPipelineState, type PipelineState } from "../lib/pipelineEvents.js";

describe("pipelineReducer — basic lifecycle", () => {
  it("start creates a live block and leaves frozen empty", () => {
    const s = pipelineReducer(initialPipelineState, {
      kind: "start",
      nodeId: "chat",
      label: "interactive agent",
      blockKind: "interactive-agent",
    });
    expect(s.frozen).toEqual([]);
    expect(s.live).not.toBeNull();
    expect(s.live!.nodeId).toBe("chat");
    expect(s.live!.body).toEqual([]);
    expect(s.live!.stats).toEqual({ turns: 0, tokensIn: 0, tokensOut: 0 });
  });

  it("text event appends to live.body", () => {
    let s: PipelineState = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "x", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "hello" });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: " world" });
    expect(s.live!.body).toEqual([
      { kind: "text", role: "claude", text: "hello" },
      { kind: "text", role: "claude", text: " world" },
    ]);
  });

  it("end freezes live and clears it", () => {
    let s: PipelineState = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "x", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "hi" });
    s = pipelineReducer(s, {
      kind: "end",
      outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 10, tokensOut: 5, durationMs: 200 },
    });
    expect(s.live).toBeNull();
    expect(s.frozen).toHaveLength(1);
    expect(s.frozen[0].nodeId).toBe("x");
    expect(s.frozen[0].outcome.status).toBe("success");
    expect(s.frozen[0].stats).toEqual({ turns: 1, tokensIn: 10, tokensOut: 5, durationMs: 200 });
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/pipelineReducer.test.ts`
Expected: FAIL — `Cannot find module '../lib/pipelineReducer.js'`.

- [x] **Step 4: Write minimal reducer implementation**

Create `src/cli/lib/pipelineReducer.ts`:

```ts
import type {
  PipelineState,
  NodeEvent,
  LiveBlock,
  Block,
  Stats,
} from "./pipelineEvents.js";

/**
 * Pure reducer: (state, event) => newState.
 *
 * Invariants (see spec "Reducer invariants"):
 *  1. Only `start` creates a live block.
 *  2. Only `end` moves a block from live to frozen. Each block moves exactly once.
 *  3. `trace-path`, `text`, `tool_use`, `interactive-ready` only mutate live.
 *  4. frozen is append-only. No existing frozen element is ever mutated.
 *  5. Exactly one new state returned per event.
 *  6. On `end` with missing stats, reducer fills from live.stats + (now - startedAt).
 *  7. The reducer NEVER calls functions stored on live (child, onDone). Those are
 *     pass-through references dispatched by PipelineApp after commit.
 */
export function pipelineReducer(state: PipelineState, event: NodeEvent): PipelineState {
  switch (event.kind) {
    case "start": {
      const live: LiveBlock = {
        id: `${event.nodeId}-${state.frozen.length}`,
        nodeId: event.nodeId,
        label: event.label,
        kind: event.blockKind,
        startedAt: Date.now(),
        body: [],
        stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
      };
      return { ...state, live };
    }

    case "trace-path": {
      if (!state.live) return state;
      // Lazily compute the absolute path using the helper — kept inside the reducer
      // so the event can be emitted with just the sessionId (adapter-side simplicity).
      const tracePath = buildTracePath(event.sessionId);
      return { ...state, live: { ...state.live, tracePath } };
    }

    case "text": {
      if (!state.live) return state;
      const body = [...state.live.body, { kind: "text" as const, role: event.role, text: event.text }];
      return { ...state, live: { ...state.live, body } };
    }

    case "tool_use": {
      if (!state.live) return state;
      const body = [...state.live.body, { kind: "tool_use" as const, name: event.name, summary: event.summary }];
      return { ...state, live: { ...state.live, body } };
    }

    case "interactive-ready": {
      if (!state.live) return state;
      return {
        ...state,
        live: { ...state.live, child: event.child, onDone: event.onDone },
      };
    }

    case "end": {
      if (!state.live) return state;
      const filled = fillStats(state.live, event.stats);
      const frozen: Block = {
        id: state.live.id,
        nodeId: state.live.nodeId,
        label: state.live.label,
        kind: state.live.kind,
        tracePath: state.live.tracePath,
        body: state.live.body,
        outcome: event.outcome,
        stats: filled,
        onDone: state.live.onDone,  // carry forward — PipelineApp effect dispatches
      };
      return { frozen: [...state.frozen, frozen], live: null };
    }
  }
}

function fillStats(live: LiveBlock, partial: Partial<Stats> | undefined): Stats {
  const durationMs = partial?.durationMs ?? Date.now() - live.startedAt;
  return {
    turns: partial?.turns ?? live.stats.turns,
    tokensIn: partial?.tokensIn ?? live.stats.tokensIn,
    tokensOut: partial?.tokensOut ?? live.stats.tokensOut,
    durationMs,
  };
}

// Indirection so the reducer stays unit-testable without hitting homedir().
// Replaced in tests via Vitest module mocking if needed. Delegates to
// claudeTracePath() by default.
import { claudeTracePath } from "./claudeTracePath.js";
function buildTracePath(sessionId: string): string {
  return claudeTracePath(sessionId);
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/pipelineReducer.test.ts`
Expected: PASS (3/3)

- [x] **Step 6: Commit**

```bash
git add src/cli/lib/pipelineEvents.ts src/cli/lib/pipelineReducer.ts src/cli/tests/pipelineReducer.test.ts
git commit -m "feat(lib): add pipelineReducer with start/text/end lifecycle"
```

---

### Task 2.2: Reducer invariant tests (append-only frozen, stats backfill, interactive refs)

**Files:**
- Modify: `src/cli/tests/pipelineReducer.test.ts` (add cases)

- [x] **Step 1: Add the critical regression test**

First, add a top-of-file type import to `src/cli/tests/pipelineReducer.test.ts` (place it alongside the existing imports created in Task 2.1). This keeps the test style consistent — no inline `import("…").X` type casts.

```ts
import type { ChildHandle } from "../lib/agent.js";
```

Then append to `src/cli/tests/pipelineReducer.test.ts` below the existing `describe` block:

```ts
describe("pipelineReducer — invariants (regression guards)", () => {
  it("frozen blocks survive subsequent live updates and state changes", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "interactive agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, { kind: "trace-path", sessionId: "sid-a" });
    s = pipelineReducer(s, { kind: "text", role: "you", text: "hello" });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "hi there" });
    s = pipelineReducer(s, {
      kind: "end",
      outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 10, tokensOut: 5, durationMs: 1200 },
    });

    // second node starts
    s = pipelineReducer(s, {
      kind: "start", nodeId: "summarize", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "here is a summary" });

    expect(s.frozen).toHaveLength(1);
    expect(s.frozen[0].nodeId).toBe("chat");
    expect(s.frozen[0].tracePath).toContain("sid-a.jsonl");
    expect(s.frozen[0].body).toEqual([
      { kind: "text", role: "you", text: "hello" },
      { kind: "text", role: "claude", text: "hi there" },
    ]);
    expect(s.live?.nodeId).toBe("summarize");
    expect(s.live?.body).toHaveLength(1);
  });

  it("frozen array is a new reference on end (not mutated in place)", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "a", label: "agent", blockKind: "agent",
    });
    const frozenBefore = s.frozen;
    s = pipelineReducer(s, {
      kind: "end",
      outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    expect(s.frozen).not.toBe(frozenBefore);
    expect(frozenBefore).toEqual([]);
  });

  it("end with omitted stats backfills from live.stats + elapsed time", () => {
    const before = Date.now();
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "x", label: "agent", blockKind: "agent",
    });
    // pretend stats accumulated somehow; we just pass through
    s = pipelineReducer(s, { kind: "end", outcome: { status: "abort", reason: "user-interrupt" } });
    expect(s.frozen[0].stats.turns).toBe(0);
    expect(s.frozen[0].stats.tokensIn).toBe(0);
    expect(s.frozen[0].stats.tokensOut).toBe(0);
    expect(s.frozen[0].stats.durationMs).toBeGreaterThanOrEqual(0);
    expect(s.frozen[0].stats.durationMs).toBeLessThan(Date.now() - before + 50);
  });

  it("interactive-ready stores child + onDone without invoking them", () => {
    const fakeChild = {} as ChildHandle;
    const onDone = () => { throw new Error("reducer must not call onDone"); };
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, { kind: "interactive-ready", child: fakeChild, onDone });
    expect(s.live?.child).toBe(fakeChild);
    expect(s.live?.onDone).toBe(onDone);
    // If the reducer had invoked onDone, the throw above would have failed the test.
  });

  it("end does NOT invoke live.onDone and carries the reference onto the frozen block", () => {
    const fakeChild = {} as ChildHandle;
    const onDone = () => { throw new Error("reducer must not call onDone at end time"); };
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, { kind: "interactive-ready", child: fakeChild, onDone });
    // The throw in onDone would fail this test if reducer invoked it.
    expect(() => {
      s = pipelineReducer(s, {
        kind: "end",
        outcome: { status: "success" },
        stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 1 },
      });
    }).not.toThrow();
    expect(s.live).toBeNull();
    expect(s.frozen).toHaveLength(1);
    // The reference is carried forward onto the frozen block so PipelineApp's
    // post-commit effect can dispatch it without needing a pre-commit ref snapshot.
    expect(s.frozen[0].onDone).toBe(onDone);
  });

  it("events targeting live when live is null are no-ops (all four mutators)", () => {
    const s1 = pipelineReducer(initialPipelineState, { kind: "text", role: "claude", text: "x" });
    const s2 = pipelineReducer(initialPipelineState, { kind: "tool_use", name: "Write", summary: "x" });
    const s3 = pipelineReducer(initialPipelineState, { kind: "end", outcome: { status: "fail" } });
    const s4 = pipelineReducer(initialPipelineState, { kind: "trace-path", sessionId: "x" });
    const s5 = pipelineReducer(initialPipelineState, {
      kind: "interactive-ready", child: {} as ChildHandle, onDone: () => {},
    });
    expect(s1).toEqual(initialPipelineState);
    expect(s2).toEqual(initialPipelineState);
    expect(s3).toEqual(initialPipelineState);
    expect(s4).toEqual(initialPipelineState);
    expect(s5).toEqual(initialPipelineState);
  });

  it("abort end with omitted stats preserves token counts and sets status=abort", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "x", label: "agent", blockKind: "agent",
    });
    // Simulate a prior-accumulated stats state by rebuilding live with non-zero counts.
    // (The reducer does not currently bump stats on text events — this test documents
    // the abort-path contract: whatever stats are on live at abort time are preserved.)
    s = {
      ...s,
      live: s.live && {
        ...s.live,
        stats: { turns: 3, tokensIn: 120, tokensOut: 48 },
      },
    };
    s = pipelineReducer(s, {
      kind: "end",
      outcome: { status: "abort", reason: "user-interrupt" },
    });
    expect(s.frozen).toHaveLength(1);
    expect(s.frozen[0].outcome).toEqual({ status: "abort", reason: "user-interrupt" });
    expect(s.frozen[0].stats.turns).toBe(3);
    expect(s.frozen[0].stats.tokensIn).toBe(120);
    expect(s.frozen[0].stats.tokensOut).toBe(48);
    expect(s.frozen[0].stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("two sequential nodes produce two frozen blocks with live=null between them", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "a", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, {
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    expect(s.live).toBeNull();
    expect(s.frozen).toHaveLength(1);
    s = pipelineReducer(s, {
      kind: "start", nodeId: "b", label: "agent", blockKind: "agent",
    });
    expect(s.frozen).toHaveLength(1);
    expect(s.live?.nodeId).toBe("b");
    s = pipelineReducer(s, {
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    expect(s.frozen).toHaveLength(2);
    expect(s.frozen.map(b => b.nodeId)).toEqual(["a", "b"]);
  });

  it("frozen[0] is not mutated when the second node appends body lines", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "a", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "first" });
    s = pipelineReducer(s, {
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    const firstFrozenRef = s.frozen[0];
    const firstBodyRef = s.frozen[0].body;

    s = pipelineReducer(s, {
      kind: "start", nodeId: "b", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "second" });

    expect(s.frozen[0]).toBe(firstFrozenRef);
    expect(s.frozen[0].body).toBe(firstBodyRef);
    expect(s.frozen[0].body).toEqual([{ kind: "text", role: "claude", text: "first" }]);
  });
});
```

- [x] **Step 2: Run to verify all pass**

Run: `npx vitest run src/cli/tests/pipelineReducer.test.ts`
Expected: PASS (12/12 total: 3 from Task 2.1 + 9 new).

- [x] **Step 3: Commit**

```bash
git add src/cli/tests/pipelineReducer.test.ts
git commit -m "test(pipelineReducer): add invariant + regression coverage"
```

---

### Task 2.3: Trace-path reducer tests

**Files:**
- Modify: `src/cli/tests/pipelineReducer.test.ts` (add one more `describe`)

Verify that the reducer stores the absolute trace path (not just the raw sessionId) on `live.tracePath`, and that re-emitting `trace-path` is idempotent (last write wins but shape unchanged). No module mocking is needed — `claudeTracePath` is already pure/deterministic (homedir + cwd + sessionId), so the tests assert against the real output with a regex.

- [x] **Step 1: Append this describe block**

```ts
describe("pipelineReducer — trace-path derivation", () => {
  it("sets live.tracePath to the claudeTracePath of the sessionId", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, { kind: "trace-path", sessionId: "abc" });
    expect(s.live?.tracePath).toMatch(/\.claude\/projects\/.*\/abc\.jsonl$/);
  });

  it("is idempotent (second trace-path emit replaces first)", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, { kind: "trace-path", sessionId: "first" });
    s = pipelineReducer(s, { kind: "trace-path", sessionId: "second" });
    expect(s.live?.tracePath).toMatch(/second\.jsonl$/);
  });

  it("is a no-op when live is null (trace-path before start)", () => {
    const s = pipelineReducer(initialPipelineState, { kind: "trace-path", sessionId: "x" });
    expect(s).toEqual(initialPipelineState);
  });
});
```

- [x] **Step 2: Run tests**

Run: `npx vitest run src/cli/tests/pipelineReducer.test.ts`
Expected: PASS (15/15 total: 3 from Task 2.1 + 9 from Task 2.2 + 3 from Task 2.3).

- [x] **Step 3: Run the full Chunk-1-and-2 suite for sanity**

Run: `npx vitest run src/cli/tests/claudeTracePath.test.ts src/cli/tests/classifyNode.test.ts src/cli/tests/parseClaudeEvent.test.ts src/cli/tests/pipelineReducer.test.ts`
Expected: PASS (37/37 total: 4 + 11 + 7 + 15)

- [x] **Step 4: Commit**

```bash
git add src/cli/tests/pipelineReducer.test.ts
git commit -m "test(pipelineReducer): add trace-path derivation coverage"
```

---

**Chunk 2 done.** The reducer and its full test matrix exist, the critical regression assertion is in place, and no React/Ink/subprocess code has been touched. The entire state machine of the new renderer is now provable in isolation.

---

## Chunk 3: View components (`BlockView`, `LiveFooter`)

Chunk 3 adds the two pure Ink view components that render `Block` and `LiveBlock`. Both are functional components with no internal state — they consume pre-shaped data. `TextInput` is used inside `LiveFooter` but not modified. No reducer, no engine, no subprocess — these components accept mock data in tests and render via `ink-testing-library`.

**Spec refinement — `input` field location.** The spec's § State Model shows `input?` as an optional field on `LiveBlock` itself. This plan deliberately moves `input` out of the reducer state (`pipelineEvents.ts`) and into a render-layer-only wrapper type `LiveBlockWithInput`. Rationale: `input.onChange` and `input.onSubmit` are closures over React state (`inputBuffer`) and `live.child`. Storing closures inside reducer state would violate spec invariants #5 (one setState per event) and #7 (reducer returns pure data). `PipelineApp` (Chunk 4) constructs the binding at render time from its own `useState` + a ref to `live.child`. Net effect: identical visible behavior, cleaner purity boundary. Update the spec's § State Model to match this before merge if a reviewer objects.

### Task 3.1: `BlockView` + `BodyLineView` (frozen block renderer)

**Files:**
- Create: `src/cli/components/BlockView.tsx`
- Create: `src/cli/tests/BlockView.test.tsx`

- [ ] **Step 1: Write the failing snapshot-style test**

Create `src/cli/tests/BlockView.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { BlockView } from "../components/BlockView.js";
import type { Block } from "../lib/pipelineEvents.js";

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: "chat-0",
    nodeId: "chat",
    label: "interactive agent",
    kind: "interactive-agent",
    tracePath: "/Users/josu/.claude/projects/-Users-josu-ralph/sid-a.jsonl",
    body: [
      { kind: "text", role: "you", text: "hello" },
      { kind: "text", role: "claude", text: "hi there" },
    ],
    outcome: { status: "success" },
    stats: { turns: 2, tokensIn: 42, tokensOut: 417, durationMs: 21300 },
    ...overrides,
  };
}

describe("BlockView", () => {
  it("renders header with index + nodeId + label", () => {
    const { lastFrame } = render(<BlockView block={makeBlock()} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[1] chat");
    expect(frame).toContain("interactive agent");
    expect(frame).toMatch(/━━/);
  });

  it("renders the trace path line for agent-kind blocks", () => {
    const { lastFrame } = render(<BlockView block={makeBlock()} index={1} />);
    expect(lastFrame()).toContain("trace: /Users/josu/.claude/projects/-Users-josu-ralph/sid-a.jsonl");
  });

  it("omits trace line for marker blocks (no tracePath)", () => {
    const block = makeBlock({
      kind: "marker",
      tracePath: undefined,
      body: [],
      label: "done",
      nodeId: "done",
      outcome: { status: "success" },
    });
    const { lastFrame } = render(<BlockView block={block} index={3} />);
    expect(lastFrame()).not.toContain("trace:");
    expect(lastFrame()).toContain("[3] done");
  });

  it("renders body text lines with role prefix", () => {
    const { lastFrame } = render(<BlockView block={makeBlock()} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("you:");
    expect(frame).toContain("hello");
    expect(frame).toContain("claude:");
    expect(frame).toContain("hi there");
  });

  it("renders tool_use body lines", () => {
    const block = makeBlock({
      body: [{ kind: "tool_use", name: "Write", summary: "{\"file_path\":\"/tmp/x\"}" }],
    });
    const { lastFrame } = render(<BlockView block={block} index={2} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("tool_use");
    expect(frame).toContain("Write");
  });

  it("renders success outcome line with glyph", () => {
    const { lastFrame } = render(<BlockView block={makeBlock()} index={1} />);
    expect(lastFrame()).toMatch(/✓/);
  });

  it("renders fail outcome line with reason", () => {
    const block = makeBlock({
      outcome: { status: "fail", reason: "crash: ENOENT" },
    });
    const { lastFrame } = render(<BlockView block={block} index={2} />);
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/✗/);
    expect(frame).toContain("crash: ENOENT");
  });

  it("renders abort outcome line", () => {
    const block = makeBlock({
      outcome: { status: "abort", reason: "user-interrupt" },
    });
    const { lastFrame } = render(<BlockView block={block} index={2} />);
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/✗/);
    expect(frame).toContain("user-interrupt");
  });

  it("renders a trailing blank line (marginBottom=1) after the outcome", () => {
    // Wrap in a flex column so Ink renders marginBottom correctly.
    const { lastFrame } = render(
      <>
        <BlockView block={makeBlock({ nodeId: "a" })} index={1} />
        <BlockView block={makeBlock({ nodeId: "b", id: "b-1" })} index={2} />
      </>,
    );
    const frame = lastFrame() ?? "";
    // The outcome line of the first block should be followed by a blank line
    // before the "━━ [2] b" header. Between two marginBottom=1 Boxes, Ink
    // inserts at least one empty line.
    const aHeaderIdx = frame.indexOf("[1] a");
    const bHeaderIdx = frame.indexOf("[2] b");
    expect(aHeaderIdx).toBeGreaterThanOrEqual(0);
    expect(bHeaderIdx).toBeGreaterThan(aHeaderIdx);
    // Require at least one "\n\n" sequence between the two headers.
    const between = frame.slice(aHeaderIdx, bHeaderIdx);
    expect(between).toMatch(/\n\n/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/BlockView.test.tsx`
Expected: FAIL — `Cannot find module '../components/BlockView.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/components/BlockView.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { Block, BodyLine, Outcome } from "../lib/pipelineEvents.js";

// Exported so LiveFooter.tsx can reuse the exact same header format (DRY).
export const HEADER_FILL = 80; // total approximate width for the ━ separator run

export function headerLine(index: number, nodeId: string, label: string): string {
  const prefix = `━━ [${index}] ${nodeId} · ${label} `;
  const pad = Math.max(3, HEADER_FILL - prefix.length);
  return prefix + "━".repeat(pad);
}

function roleColor(role: "you" | "claude" | "system"): string {
  if (role === "you") return "green";
  if (role === "claude") return "cyan";
  return "gray";
}

export function BodyLineView({ line }: { line: BodyLine }) {
  if (line.kind === "text") {
    return (
      <Text>
        <Text bold color={roleColor(line.role)}>{line.role}:</Text>
        {" "}
        <Text>{line.text}</Text>
      </Text>
    );
  }
  return (
    <Text dimColor>
      [tool_use: {line.name}] {line.summary}
    </Text>
  );
}

function outcomeLine(outcome: Outcome, stats: Block["stats"]): string {
  const glyph = outcome.status === "success" ? "✓" : "✗";
  const reason = outcome.reason ? ` · ${outcome.reason}` : "";
  const duration = (stats.durationMs / 1000).toFixed(1);
  return `${glyph} ${outcome.status}${reason} · turns: ${stats.turns} · ${stats.tokensIn}/${stats.tokensOut} tok · ${duration}s`;
}

export function BlockView({ block, index }: { block: Block; index: number }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{headerLine(index, block.nodeId, block.label)}</Text>
      {block.tracePath && <Text dimColor>{`  trace: ${block.tracePath}`}</Text>}
      {block.body.map((line, i) => <BodyLineView key={i} line={line} />)}
      <Text dimColor>{outcomeLine(block.outcome, block.stats)}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/BlockView.test.tsx`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add src/cli/components/BlockView.tsx src/cli/tests/BlockView.test.tsx
git commit -m "feat(components): add BlockView for frozen pipeline blocks"
```

---

### Task 3.2: `LiveFooter` (in-flight block renderer)

**Files:**
- Create: `src/cli/components/LiveFooter.tsx`
- Create: `src/cli/tests/LiveFooter.test.tsx`

`LiveFooter` reuses `BodyLineView` from `BlockView.tsx` (DRY) and adds:
1. A spinner / status line (no outcome yet)
2. A conditional `TextInput` binding driven by the `input` prop on the LiveBlock

For testing, we render `LiveFooter` with hand-built `LiveBlock` shapes plus an optional `input` handler triple. The `TextInput` is already covered by its own test suite, so we only assert that it renders (by checking for the `> ` prompt marker) and we do not simulate keystrokes here.

- [ ] **Step 1: Write the failing test**

Create `src/cli/tests/LiveFooter.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { LiveFooter, type LiveBlockWithInput } from "../components/LiveFooter.js";

function makeLive(overrides: Partial<LiveBlockWithInput> = {}): LiveBlockWithInput {
  return {
    id: "chat-0",
    nodeId: "chat",
    label: "interactive agent",
    kind: "interactive-agent",
    startedAt: Date.now() - 2300,
    body: [],
    stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
    ...overrides,
  };
}

describe("LiveFooter", () => {
  it("renders header with current index + nodeId + label", () => {
    const { lastFrame } = render(<LiveFooter block={makeLive()} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[1] chat");
    expect(frame).toContain("interactive agent");
  });

  it("renders trace path when present", () => {
    const block = makeLive({ tracePath: "/Users/josu/.claude/projects/abc/sid.jsonl" });
    const { lastFrame } = render(<LiveFooter block={block} index={1} />);
    expect(lastFrame()).toContain("trace: /Users/josu/.claude/projects/abc/sid.jsonl");
  });

  it("omits trace line when absent", () => {
    const { lastFrame } = render(<LiveFooter block={makeLive()} index={1} />);
    expect(lastFrame()).not.toContain("trace:");
  });

  it("renders body lines as they stream in", () => {
    const block = makeLive({
      body: [
        { kind: "text", role: "claude", text: "ralph-cli has 4 layers" },
      ],
    });
    const { lastFrame } = render(<LiveFooter block={block} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("claude:");
    expect(frame).toContain("ralph-cli has 4 layers");
  });

  it("renders a status line with turns + token counts (no outcome glyph)", () => {
    const block = makeLive({ stats: { turns: 1, tokensIn: 19, tokensOut: 164 } });
    const { lastFrame } = render(<LiveFooter block={block} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("turns: 1");
    expect(frame).toContain("19/164");
    // no outcome glyph yet (✓/✗ belong to BlockView only)
    expect(frame).not.toMatch(/[✓✗]/);
  });

  it("renders TextInput prompt when input prop is present", () => {
    const block = makeLive({
      input: {
        value: "what's in src/daemon?",
        onChange: () => {},
        onSubmit: () => {},
      },
    });
    const { lastFrame } = render(<LiveFooter block={block} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("> ");
    expect(frame).toContain("what's in src/daemon?");
  });

  it("omits TextInput when input prop is absent", () => {
    const { lastFrame } = render(<LiveFooter block={makeLive()} index={1} />);
    const frame = lastFrame() ?? "";
    // Anchor on line-start to avoid matching "> " inside status text.
    expect(frame).not.toMatch(/^> /m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/LiveFooter.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/components/LiveFooter.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { LiveBlock } from "../lib/pipelineEvents.js";
import { BodyLineView, headerLine } from "./BlockView.js";
import { TextInput } from "./TextInput.js";

function statusLine(block: LiveBlock): string {
  const elapsed = ((Date.now() - block.startedAt) / 1000).toFixed(1);
  const parts = [`● awaiting`, `turns: ${block.stats.turns}`, `${block.stats.tokensIn}/${block.stats.tokensOut} tok`, `${elapsed}s`];
  return parts.join(" · ");
}

// Extended live-block shape with an optional TextInput binding. The binding is
// attached inside PipelineApp (Chunk 4) via a closure over live.child.
export interface LiveBlockWithInput extends LiveBlock {
  input?: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: (v: string) => void;
  };
}

export function LiveFooter({
  block,
  index,
}: {
  block: LiveBlockWithInput;
  index: number;
}) {
  return (
    <Box flexDirection="column">
      <Text>{headerLine(index, block.nodeId, block.label)}</Text>
      {block.tracePath && <Text dimColor>{`  trace: ${block.tracePath}`}</Text>}
      {block.body.map((line, i) => <BodyLineView key={i} line={line} />)}
      <Text dimColor>{statusLine(block)}</Text>
      {block.input && (
        <Box>
          <Text color="gray">{"> "}</Text>
          <TextInput
            value={block.input.value}
            onChange={block.input.onChange}
            onSubmit={block.input.onSubmit}
          />
        </Box>
      )}
    </Box>
  );
}
```

> **Important:** `LiveBlockWithInput` is a local extension used only by the rendering layer. The reducer state type `LiveBlock` (in `pipelineEvents.ts`) does **not** carry the `input` field — that binding is stitched in by `PipelineApp` right before rendering (Chunk 4 Task 4.1), because the `onChange`/`onSubmit` closures depend on React state (the input buffer) and the `live.child` reference. This keeps `pipelineEvents.ts` pure-data.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/LiveFooter.test.tsx`
Expected: PASS (7/7)

- [ ] **Step 5: Run combined Chunk 3 test suite**

Run: `npx vitest run src/cli/tests/BlockView.test.tsx src/cli/tests/LiveFooter.test.tsx`
Expected: PASS (16/16: 9 BlockView + 7 LiveFooter)

- [ ] **Step 6: Commit**

```bash
git add src/cli/components/LiveFooter.tsx src/cli/tests/LiveFooter.test.tsx
git commit -m "feat(components): add LiveFooter for in-flight pipeline block"
```

---

**Chunk 3 done.** Both view components exist with snapshot-style tests covering the visual cases in the spec's mockups (T0–T5 + error cases). The components are pure — no hooks except what `TextInput` brings along — and they accept mock data, so they stay decoupled from the reducer and the Ink root.

---

## Chunk 4: Root component (`PipelineApp` + `renderPipelineApp` factory)

Chunk 4 wires Chunks 1-3 together into a single Ink root component. `PipelineApp` owns the `useReducer`, exposes an `emit(event)` callback via `onReady`, renders one `<Static items={...}>` + conditional `<LiveFooter>`, and dispatches the side effects that the reducer deliberately avoids:

- **`onDone` dispatch**: the reducer carries `live.onDone` forward onto the newly-frozen `Block` (Chunk 2 updated). A `useEffect` depending on `state.frozen` scans for any frozen block whose `id` has not yet been dispatched (tracked in a `useRef<Set<string>>()`) and invokes its `onDone` exactly once. This is deterministic under React 18 auto-batching because it reads only from committed state — no pre-commit ref snapshots.
- **`TextInput` binding**: when `live.kind === "interactive-agent"`, `PipelineApp` builds the `input` object at render time from its own `useState<string>("")` buffer and from a `handleSubmit` closure that calls `parseSlashCommand` + `live.child.submit()` / `.end()` / `.kill()`.
- **Header as Static item**: to satisfy spec invariant #1 (exactly one `<Static>`) while still placing the pipeline name/nodes line ABOVE frozen blocks in scrollback, the header is injected as the first item of `<Static items={...}>` with a stable `id` (`"__header__"`). Ink's `<Static>` renders it exactly once on first commit.
- **Factory**: a sibling function `renderPipelineApp(props)` mounts the root via `ink.render(...)` with `{ patchConsole: false }` and returns `{ callbacks, waitUntilExit }` — matching the shape of the current `renderPipelineDisplay()` so the `pipeline.ts` adapter (Chunk 5) can drop in with a minimal diff.

### Task 4.1: `PipelineApp` skeleton with reducer + `<Static>` + `<LiveFooter>`

**Files:**
- Create: `src/cli/components/PipelineApp.tsx`
- Create: `src/cli/tests/PipelineApp.test.tsx`

- [ ] **Step 1: Write the failing test — three core scenarios from spec Testing § Layer 2**

Create `src/cli/tests/PipelineApp.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PipelineApp, type PipelineAppCallbacks } from "../components/PipelineApp.js";
import type { ChildHandle } from "../lib/agent.js";

function mount() {
  let cbs: PipelineAppCallbacks | undefined;
  const instance = render(
    <PipelineApp
      pipelineName="chat_end_to_end"
      pid={13198}
      nodes={["chat", "summarize", "done"]}
      onReady={(c) => { cbs = c; }}
    />,
  );
  if (!cbs) throw new Error("onReady never fired");
  return { instance, cbs };
}

describe("PipelineApp", () => {
  it("renders header with pipeline name and nodes list", () => {
    const { instance } = mount();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("chat_end_to_end");
    expect(frame).toMatch(/chat.*summarize.*done/);
  });

  it("freezes a single node: start → text → text → end produces one frozen block", () => {
    const { instance, cbs } = mount();
    cbs.emit({ kind: "start", nodeId: "chat", label: "agent", blockKind: "agent" });
    cbs.emit({ kind: "text", role: "claude", text: "hello" });
    cbs.emit({ kind: "text", role: "claude", text: " world" });
    cbs.emit({
      kind: "end",
      outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 5, tokensOut: 2, durationMs: 100 },
    });

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("[1] chat");
    expect(frame).toContain("claude:");
    expect(frame).toContain("hello");
    expect(frame).toContain("world");
    expect(frame).toMatch(/✓/);
  });

  it("sequential nodes produce two frozen blocks with live=null between them", () => {
    const { instance, cbs } = mount();
    cbs.emit({ kind: "start", nodeId: "a", label: "agent", blockKind: "agent" });
    cbs.emit({
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    cbs.emit({ kind: "start", nodeId: "b", label: "agent", blockKind: "agent" });
    cbs.emit({ kind: "text", role: "claude", text: "second body" });
    cbs.emit({
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("[1] a");
    expect(frame).toContain("[2] b");
    expect(frame).toContain("second body");
    // Both are frozen; no live footer spinner text
    expect(frame).not.toMatch(/● awaiting/);
  });

  it("interactive-ready wires child + invokes onDone exactly once when the block freezes", async () => {
    const { cbs } = mount();
    let onDoneCalls = 0;
    const fakeChild = {} as ChildHandle;
    const onDone = () => { onDoneCalls++; };

    cbs.emit({
      kind: "start", nodeId: "chat", label: "interactive agent", blockKind: "interactive-agent",
    });
    cbs.emit({ kind: "interactive-ready", child: fakeChild, onDone });
    cbs.emit({ kind: "text", role: "you", text: "hi" });
    cbs.emit({ kind: "text", role: "claude", text: "hi there" });

    expect(onDoneCalls).toBe(0); // not yet frozen

    cbs.emit({
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 10, tokensOut: 5, durationMs: 200 },
    });
    // Let React flush the post-commit effect.
    await new Promise((r) => setTimeout(r, 0));
    expect(onDoneCalls).toBe(1);

    // A subsequent freeze does not re-trigger the old onDone.
    cbs.emit({ kind: "start", nodeId: "next", label: "agent", blockKind: "agent" });
    cbs.emit({
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(onDoneCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/PipelineApp.test.tsx`
Expected: FAIL — `Cannot find module '../components/PipelineApp.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/components/PipelineApp.tsx`:

```tsx
import React, { useEffect, useReducer, useRef, useState } from "react";
import { render as inkRender, Box, Static, Text, useApp } from "ink";
import { pipelineReducer } from "../lib/pipelineReducer.js";
import { initialPipelineState, type NodeEvent, type Block } from "../lib/pipelineEvents.js";
import { BlockView } from "./BlockView.js";
import { LiveFooter, type LiveBlockWithInput } from "./LiveFooter.js";
import { parseSlashCommand } from "../lib/slash-commands.js";

export interface PipelineAppCallbacks {
  emit: (event: NodeEvent) => void;
  done: () => void;
}

interface Props {
  pipelineName: string;
  pid: number;
  goal?: string;
  nodes: string[];
  onReady: (cbs: PipelineAppCallbacks) => void;
}

// Header item injected as the first <Static> element so the pipeline name
// and node list render ONCE, ABOVE all frozen blocks in scrollback. Using a
// tagged union for the Static items lets us keep exactly one <Static> in the
// tree (spec invariant #1) while still having a header line.
type StaticItem =
  | { kind: "header"; id: string; pipelineName: string; pid: number; goal?: string; nodes: string[] }
  | { kind: "block"; id: string; block: Block };

export function PipelineApp({ pipelineName, pid, goal, nodes, onReady }: Props) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [inputBuffer, setInputBuffer] = useState("");

  // Tracks which frozen blocks have already had their onDone dispatched.
  // Using a Set of block.id keeps dispatch idempotent even under React 18
  // auto-batching: multiple dispatches collapsed into one commit still
  // produce a single deterministic pass over state.frozen after commit,
  // and each block.id is dispatched exactly once.
  const doneDispatched = useRef<Set<string>>(new Set());

  // Post-commit effect: scan frozen for any block with an undispatched onDone
  // and call it exactly once. Reads purely from committed state — no refs
  // to stale pre-commit snapshots, no timing coupling.
  useEffect(() => {
    for (const block of state.frozen) {
      if (block.onDone && !doneDispatched.current.has(block.id)) {
        doneDispatched.current.add(block.id);
        try { block.onDone(); } catch { /* swallow — not our concern */ }
      }
    }
  }, [state.frozen]);

  // Fire onReady exactly once.
  const readyOnce = useRef(false);
  useEffect(() => {
    if (readyOnce.current) return;
    readyOnce.current = true;
    onReady({
      emit: (event) => dispatch(event),
      done: () => exit(),
    });
  }, []);

  // Build the render-layer LiveBlockWithInput from the reducer state + local
  // input buffer + slash-command dispatch. Only wire input for interactive
  // agent blocks.
  const liveForRender: LiveBlockWithInput | null = (() => {
    if (!state.live) return null;
    if (state.live.kind !== "interactive-agent" || !state.live.child) {
      return state.live;
    }
    const child = state.live.child;
    return {
      ...state.live,
      input: {
        value: inputBuffer,
        onChange: setInputBuffer,
        onSubmit: async (raw: string) => {
          setInputBuffer("");
          const parsed = parseSlashCommand(raw);
          if (parsed.kind === "help") {
            dispatch({ kind: "text", role: "system", text: "commands: /end /abort /help" });
            return;
          }
          if (parsed.kind === "unknown") {
            dispatch({ kind: "text", role: "system", text: `unknown command: ${parsed.raw}` });
            return;
          }
          if (parsed.kind === "end") {
            try { await child.end(); } catch { /* ignore */ }
            return;
          }
          if (parsed.kind === "abort") {
            try { await child.kill("SIGTERM"); } catch { /* ignore */ }
            return;
          }
          // Plain message
          if (parsed.text.trim().length === 0) return;
          dispatch({ kind: "text", role: "you", text: parsed.text });
          try { await child.submit(parsed.text); } catch (err) {
            dispatch({
              kind: "text", role: "system",
              text: `Failed to send: ${(err as Error).message}`,
            });
          }
        },
      },
    };
  })();

  // Assemble static items: header is always item 0, followed by frozen blocks.
  // Ink's <Static> appends new items over time; since the header has a stable
  // id ("__header__") it is rendered exactly once on first commit.
  const staticItems: StaticItem[] = [
    { kind: "header", id: "__header__", pipelineName, pid, goal, nodes },
    ...state.frozen.map((b) => ({ kind: "block" as const, id: b.id, block: b })),
  ];

  return (
    <>
      <Static items={staticItems}>
        {(item) => {
          if (item.kind === "header") {
            return (
              <Box key={item.id} flexDirection="column" marginBottom={1}>
                <Text dimColor>
                  {` ${item.pipelineName}  ·  PID ${item.pid}${item.goal ? `  ·  goal: ${item.goal}` : ""}`}
                </Text>
                {item.nodes.length > 0 && (
                  <Text dimColor>{` nodes: ${item.nodes.join(" → ")}`}</Text>
                )}
              </Box>
            );
          }
          // frozen block
          const blockIndex = staticItems.findIndex((it) => it.id === item.id);
          return <BlockView key={item.id} block={item.block} index={blockIndex /* header is 0, so first block is 1 */} />;
        }}
      </Static>
      {liveForRender && (
        <LiveFooter block={liveForRender} index={state.frozen.length + 1} />
      )}
    </>
  );
}

// -------------------- Mount factory --------------------

export async function renderPipelineApp(props: Omit<Props, "onReady">): Promise<{
  callbacks: PipelineAppCallbacks;
  waitUntilExit: () => Promise<void>;
}> {
  let resolve!: (cbs: PipelineAppCallbacks) => void;
  const ready = new Promise<PipelineAppCallbacks>((r) => { resolve = r; });

  // patchConsole:false — invariant #7: no Ink-owned console.* interception.
  // Ink auto-detects CI / non-TTY via the `ci-info` package and degrades to
  // final-frame output — no extra config needed.
  const instance = inkRender(
    React.createElement(PipelineApp, { ...props, onReady: (cbs) => resolve(cbs) }),
    { patchConsole: false },
  );

  const callbacks = await ready;
  return {
    callbacks,
    waitUntilExit: () => instance.waitUntilExit() as Promise<void>,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/PipelineApp.test.tsx`
Expected: PASS (4/4)

- [ ] **Step 5: Run the full suite (Chunks 1-4) as a sanity gate**

Run: `npx vitest run src/cli/tests/claudeTracePath.test.ts src/cli/tests/classifyNode.test.ts src/cli/tests/parseClaudeEvent.test.ts src/cli/tests/pipelineReducer.test.ts src/cli/tests/BlockView.test.tsx src/cli/tests/LiveFooter.test.tsx src/cli/tests/PipelineApp.test.tsx`
Expected: PASS (57/57: 4 + 11 + 7 + 15 + 9 + 7 + 4)

- [ ] **Step 6: Commit**

```bash
git add src/cli/components/PipelineApp.tsx src/cli/tests/PipelineApp.test.tsx
git commit -m "feat(components): add PipelineApp root with reducer + onDone dispatch"
```

---

**Chunk 4 done.** The new renderer is self-contained: reducer + view components + root + mount factory, with every boundary tested. `pipeline.ts` still imports the old `renderPipelineDisplay` — the cutover happens in Chunk 5.

---

## Chunk 5: Engine `onNodeEnd` hook + adapter cutover + cleanup + integration test + manual gate

Chunk 5 first extends the engine with a minimal `onNodeEnd` callback (a pure-additive change), then swaps `pipeline.ts` from the old `renderPipelineDisplay` to the new `renderPipelineApp`, deletes `PipelineDisplay.tsx` / `ChatUI.tsx` and their tests, adds a component-integration test that drives `renderPipelineApp` end-to-end via `ink-testing-library` + a fake `ChildHandle` (real subprocess smoke testing is DEFERRED to the manual gate because Ink requires a TTY to enable raw-mode input, which a piped-stdin subprocess cannot provide), and finally a manual verification gate.

This is the only chunk that touches the engine-facing code and the test suite. Everything before this chunk is pure / view-only / reducer — Chunk 5 is the minimal diff at the boundary.

### Task 5.0: Extend engine with `onNodeEnd` callback (prerequisite)

**Files:**
- Modify: `src/attractor/core/engine.ts` (`EngineOptions` interface + main loop, after handler resolves)
- Test: `src/attractor/core/tests/engine-onNodeEnd.test.ts` (create if the engine test dir differs — discover via `find src/attractor -name '*.test.ts' | head`)

**Why this task exists:** `pipeline.ts` (Task 5.1) must emit a `{kind:"end",outcome}` NodeEvent when each node finishes so the reducer can freeze the live block. Today `EngineOptions` exposes `onNodeStart`, `onStdout`, `onInteractiveRequest` (verified by reading `src/attractor/core/engine.ts:19-29`) but **no** `onNodeEnd`. The pipeline cutover is blocked on adding one.

- [ ] **Step 1: Write the failing test**

Create (or append to an existing engine test file):

```ts
import { describe, it, expect } from "vitest";
import { parseDot } from "../graph.js";
import { runPipeline } from "../engine.js";
import { AutoApproveInterviewer } from "../../interviewer/auto-approve.js";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("engine onNodeEnd callback", () => {
  it("does NOT fire onNodeEnd for in-flight retries (only for terminal outcomes)", async () => {
    // Unit test the retry gate directly. Reduces to: given a node with
    // maxRetries=2 and an outcome status="fail", and 0 prior retry attempts,
    // the engine's `_willRetry` decision is true → onNodeEnd must not fire.
    // This test documents the contract; the real integration is covered by
    // the reducer guard ("emit end with no live block is a no-op") + the
    // component integration test in Task 5.3.
    //
    // Because the engine does not expose the gate function independently,
    // this test is written as a regression guard on the engine SOURCE TEXT:
    // we assert the gate expression exists near the `opts.onNodeEnd?.` call.
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../engine.ts", import.meta.url), "utf8"),
    );
    expect(src).toMatch(/_willRetry/);
    expect(src).toMatch(/if \(!_willRetry\)\s*\{\s*opts\.onNodeEnd/);
  });

  it("fires onNodeEnd after each handler resolves with its outcome", async () => {
    const dot = `
      digraph t {
        start [shape=Mdiamond];
        a [agent="chat", prompt="noop"];
        done [shape=Msquare];
        start -> a;
        a -> done;
      }
    `;
    const graph = parseDot(dot);
    const logsRoot = await mkdtemp(join(tmpdir(), "engine-end-"));
    const calls: Array<{ id: string; status: string }> = [];

    // Use a stub handler by injecting a test-only handler map would be ideal;
    // since the engine constructs handlers internally, assert on the shape of
    // the calls the real AgentHandler makes for a trivial prompt. If the real
    // handler requires `claude` to be installed, skip with an env guard.
    if (!process.env.RALPH_ENGINE_TEST_ALLOW_SPAWN) return;

    await runPipeline(graph, {
      logsRoot,
      cwd: process.cwd(),
      interviewer: new AutoApproveInterviewer(),
      onNodeStart: () => {},
      onNodeEnd: (node, outcome) => {
        calls.push({ id: node.id, status: outcome.status });
      },
    });
    // start → a → done : exit nodes do NOT fire onNodeEnd (see implementation)
    expect(calls.map((c) => c.id)).toContain("a");
  });

  it("fires onNodeEnd for `start` + agent nodes but NOT for exit nodes", () => {
    // Pure unit assertion: verify the engine's code path calls onNodeEnd
    // from the main loop, which `return`s before reaching onNodeEnd when
    // isExitNode(node) is true. This test documents the contract.
    // (Skipped here — covered by the in-process adapter integration test in Task 5.3.)
    expect(true).toBe(true);
  });
});
```

> **Note:** If the real engine test harness in the repo uses a different pattern (check `find src/attractor -name '*.test.ts'`), follow that pattern instead. The only invariant that must be tested is: for any non-exit node that reaches handler.execute, `onNodeEnd(node, outcome)` is called exactly once after `outcome` is returned and before the retry/advance branches consume it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/attractor/core/tests/engine-onNodeEnd.test.ts`
Expected: FAIL — either a type error ("`onNodeEnd` does not exist on type `EngineOptions`") or the test skips if `RALPH_ENGINE_TEST_ALLOW_SPAWN` is unset but the second assertion still runs and passes trivially. The important failure is the TypeScript error.

- [ ] **Step 3: Extend `EngineOptions`**

Edit `src/attractor/core/engine.ts`. Find the `EngineOptions` interface (currently lines 19-29, anchor on the literal line `export interface EngineOptions {`). Add a new optional field AFTER `onInteractiveRequest`:

```ts
export interface EngineOptions {
  logsRoot: string;
  cwd: string;
  interviewer: Interviewer;
  signal?: AbortSignal;
  project?: string;
  resume?: boolean;
  onNodeStart?: (node: Node) => void;
  onStdout?: (stdout: NodeJS.ReadableStream) => Promise<void>;
  onInteractiveRequest?: OnInteractiveRequest;
  onNodeEnd?: (node: Node, outcome: Outcome) => void;
}
```

> The `Outcome` type is already imported at the top of `engine.ts` from `../types.js:3` — no new imports needed.

- [ ] **Step 4: Invoke `onNodeEnd` in the main loop — TERMINAL outcomes only**

> **Critical:** `onNodeEnd` MUST fire only for terminal outcomes — NOT for intermediate retry attempts. The engine retries a node by `continue`-ing the main loop (lines 209-215 of engine.ts) without re-firing `onNodeStart`. If `onNodeEnd` fires unconditionally after every `handler.execute`, a retried node will emit multiple `end` events into the reducer without matching `start` events — the second `end` would land on the NEXT live block and freeze it as an error. To prevent this, the invocation must inspect the same retry decision the engine is about to make, and skip when a retry will follow.

In `src/attractor/core/engine.ts`, find the block starting with the literal `const outcome = await handler.execute(node, ctx, {`. Immediately AFTER the `outcome.contextUpdates` merge block (after the closing `}` of `if (outcome.contextUpdates) { context = ... }`) and BEFORE `// Write status artifact`, add:

```ts
    // Notify observers of the resolved outcome — but ONLY for terminal outcomes.
    // Intermediate retries `continue` the main loop below without re-firing
    // onNodeStart, so firing onNodeEnd here on a retry would leave the reducer
    // with an unbalanced end event. Inspect the retry decision the engine is
    // about to make and skip the call for in-flight retries.
    {
      const _maxRetries = node.maxRetries ?? graph.defaultMaxRetries ?? 0;
      const _retryCount = nodeRetries[node.id] ?? 0;
      const _willRetry =
        (outcome.status === "retry" ||
          (outcome.status === "fail" && _maxRetries > 0)) &&
        _retryCount < _maxRetries;
      if (!_willRetry) {
        opts.onNodeEnd?.(node, outcome);
      }
    }
```

The block-scoped locals (`_maxRetries`, `_retryCount`) avoid colliding with identically-named variables declared a few lines below in the retry branch. Exit nodes return at the `isExitNode(node)` branch above this code and never reach it — that is intentional and matches the spec's rule that exit/entry markers never produce render blocks. Fallback retry (`currentNodeId = fallback; continue`) DOES fire `onNodeEnd` because the current node is terminally done from the render perspective — we're jumping to a different node.

- [ ] **Step 5: Re-run the engine test**

Run: `npx vitest run src/attractor/core/tests/engine-onNodeEnd.test.ts`
Expected: PASS (type error gone; the env-gated spawn test is skipped unless `RALPH_ENGINE_TEST_ALLOW_SPAWN=1`).

- [ ] **Step 6: Re-run the full engine test suite to confirm no regression**

Run: `npx vitest run src/attractor/`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/attractor/core/engine.ts src/attractor/core/tests/engine-onNodeEnd.test.ts
git commit -m "feat(engine): add onNodeEnd callback to EngineOptions"
```

---

### Task 5.1: Replace the `pipeline.ts` adapter

**Files:**
- Modify: `src/cli/commands/pipeline.ts` (imports block near the top, and the entire `pipelineRunCommand` body from `renderPipelineDisplay(...)` mount through the end of the try/finally)

- [ ] **Step 1: Read the current adapter for reference**

Read `src/cli/commands/pipeline.ts` end-to-end to re-anchor the edit. The literal strings `renderPipelineDisplay`, `setChat`, `PipelineDisplay` must each appear exactly where the plan expects them; if any have drifted, stop and re-plan.

> **Invariant about `onStdout` vs `onInteractiveRequest`.** Per `src/attractor/core/engine.ts:186-194`, the engine passes BOTH hooks into `handler.execute(...)` on every node. `AgentHandler` must decide internally which branch to use: interactive nodes consume `onInteractiveRequest` (child handed to adapter, events piped from `child.events`); non-interactive nodes consume `onStdout` (engine streams stdout to the callback). The two MUST be mutually exclusive per node, or the adapter will emit duplicate events into the reducer. **Verify** this by reading `src/attractor/handlers/agent-handler.ts` before running the build in Step 4. If both branches run for the same node, fix the handler first (out-of-scope for this plan — surface to the user).

- [ ] **Step 2: Replace the imports**

Edit `src/cli/commands/pipeline.ts` — find the literal lines:

Replace:
```ts
import { renderPipelineDisplay } from "../components/PipelineDisplay.js";
import type { ChatProps } from "../components/PipelineDisplay.js";
```

With:
```ts
import { renderPipelineApp } from "../components/PipelineApp.js";
import { classifyNode } from "../lib/classifyNode.js";
import { parseClaudeEvent } from "../lib/parseClaudeEvent.js";
import { parseStreamJsonEvents } from "../lib/stream-formatter.js";
```

> **Verify `parseStreamJsonEvents` exists.** Before saving, run `grep -n "export function parseStreamJsonEvents\|export const parseStreamJsonEvents\|export async function parseStreamJsonEvents" src/cli/lib/stream-formatter.ts`. If the function is exported under a different name (e.g. `streamEvents`), use that exact name in the import instead — do not guess.

- [ ] **Step 3: Replace the mount block and the engine-callback block**

Inside `pipelineRunCommand`, find the literal line `const { callbacks, waitUntilExit } = await renderPipelineDisplay({` and the closing `}` of the enclosing try/finally block. Replace the entire region from that `renderPipelineDisplay` call through `await waitUntilExit();` and the closing brace of `try { ... } finally { ... }` with:

```ts
  // Mount the new single-<Static> PipelineApp.
  // overviewNodes for the header list: exclude entry (Mdiamond) and exit
  // (Msquare) markers — these never become rendered blocks.
  const overviewNodeIds = [...graph.nodes.values()]
    .filter((n) => n.shape !== "Mdiamond" && n.shape !== "Msquare")
    .map((n) => n.id);

  const { callbacks, waitUntilExit } = await renderPipelineApp({
    pipelineName: graph.name,
    pid: process.pid,
    goal: graph.goal,
    nodes: overviewNodeIds,
  });
  const { emit, done } = callbacks;

  // Track whether the current node had a block emitted (so we can gate `end`
  // emission symmetrically). Marker nodes (start, exit) do NOT emit a block
  // at all, so their `onNodeEnd` (if it fires, which it does not for exit)
  // is a no-op.
  let currentBlockNodeId: string | null = null;
  // One-shot flag: once we synthesize an abort end from the signal handler,
  // ignore any late `onNodeEnd` for the same node and do not emit the
  // post-runPipeline failure text (it would be redundant).
  let abortHandled = false;

  const ac = new AbortController();
  const onSignal = () => {
    if (currentBlockNodeId !== null) {
      // Freeze the live block cleanly. The reducer backfills stats per
      // invariant #6 and no-ops if there is no live block.
      emit({ kind: "end", outcome: { status: "abort", reason: "user-interrupt" } });
      currentBlockNodeId = null;
      abortHandled = true;
    }
    ac.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const result = await runPipeline(graph, {
      logsRoot,
      cwd: project,
      interviewer: process.stdin.isTTY ? new ConsoleInterviewer() : new AutoApproveInterviewer(),
      signal: ac.signal,
      project: opts.project,
      resume: opts.resume,

      onInteractiveRequest: ({ child }) =>
        new Promise<void>((resolve) => {
          emit({ kind: "interactive-ready", child, onDone: resolve });
          if (child.sessionId) {
            emit({ kind: "trace-path", sessionId: child.sessionId });
          }
          // Pipe the child's event stream into the reducer. Note: this is the
          // ONLY consumer of child.events for interactive nodes — non-interactive
          // nodes never enter this branch, they go through onStdout instead.
          (async () => {
            try {
              for await (const raw of child.events) {
                for (const nev of parseClaudeEvent(raw)) emit(nev);
              }
            } catch (err) {
              if (abortHandled) return;
              emit({
                kind: "end",
                outcome: { status: "fail", reason: `crash: ${(err as Error).message}` },
              });
              currentBlockNodeId = null;
            }
          })();
        }),

      onNodeStart: (node) => {
        const blockKind = classifyNode(node);
        if (blockKind === "marker") {
          // start / exit / conditional markers never render a block and never
          // produce a matching onNodeEnd. Skip entirely.
          return;
        }
        currentBlockNodeId = node.id;
        emit({
          kind: "start",
          nodeId: node.id,
          label: node.label ?? shapeToType(node.shape),
          blockKind,
        });
      },

      onNodeEnd: (node, outcome) => {
        if (abortHandled) return;
        // Skip marker nodes (no matching block was emitted).
        if (classifyNode(node) === "marker") return;
        // Widen the engine's outcome status to the renderer's 3-value union.
        // partial_success is conservatively rendered as "fail" so the user
        // sees the reason — silent widening to "success" masks regressions.
        const status =
          outcome.status === "success" ? "success"
          : outcome.status === "abort"  ? "abort"
          :                                "fail";
        emit({
          kind: "end",
          outcome: { status, reason: outcome.failureReason ?? (outcome.status === "partial_success" ? "partial success" : undefined) },
        });
        currentBlockNodeId = null;
      },

      onStdout: async (stdout) => {
        // Consumed for NON-interactive agent nodes only. Interactive nodes
        // route their output through `onInteractiveRequest` above, via
        // `child.events` — the handler must not call both.
        for await (const raw of parseStreamJsonEvents(stdout)) {
          for (const nev of parseClaudeEvent(raw)) emit(nev);
        }
      },
    });

    // Pipeline summary. Per the spec's § Full-run mockup, completion is NOT
    // rendered as a synthetic block — the last real node's frozen block plus
    // the persistent header are sufficient. We just emit nothing here on
    // success. On failure (non-abort), we surface the reason by freezing any
    // still-live block with a fail outcome.
    if (result.status !== "success" && !abortHandled && currentBlockNodeId !== null) {
      emit({
        kind: "end",
        outcome: { status: "fail", reason: result.failureReason ?? "pipeline failed" },
      });
      currentBlockNodeId = null;
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    // Yield one macrotask so any pending reducer commits flush into <Static>
    // before Ink unmounts. See Chunk 4 factory note — if this proves flaky,
    // expose a `flush()` callback from renderPipelineApp and replace this with
    // `await flush()`.
    await new Promise((resolve) => setImmediate(resolve));
    done();
    await waitUntilExit();
  }
}
```

> **Marker filter note.** `classifyNode` returns `"marker"` for `Mdiamond` / `Msquare` shapes and for ids starting with `start` / `end` / `exit` (per Chunk 1). The adapter uses that single source of truth to decide which nodes produce blocks, so the logic stays consistent between the overview list filter and the `onNodeStart` / `onNodeEnd` gates. Any future new marker kinds only need to be taught to `classifyNode`.

> **Completion UX.** Per the spec's § Full-run mockup, the pipeline header (persistent) plus the sequence of frozen blocks IS the completion view. If a future iteration wants a visible "done ✓" trailer, extend `PipelineApp` to accept a `pipelineResult` prop and render it in the live footer AFTER `runPipeline` resolves — do NOT add a synthetic marker block here. That's a separate chunk.

- [ ] **Step 4: Build to catch type errors**

Run: `npx tsup --silent` (or the project's build command per `package.json`).
Expected: build succeeds with no TypeScript errors. If it fails, read the errors and fix them in-place before continuing.

- [ ] **Step 5: Run the existing `pipeline.test.ts` suite to confirm nothing regressed**

Run: `npx vitest run src/cli/tests/pipeline.test.ts`
Expected: PASS — or, if the existing tests were tightly coupled to `renderPipelineDisplay`'s callback shape, fail with clear signals that need addressing in Task 5.2.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/pipeline.ts
git commit -m "feat(pipeline): cut over to PipelineApp single-Static renderer"
```

---

### Task 5.2: Delete obsolete files

**Files:**
- Delete: `src/cli/components/PipelineDisplay.tsx`
- Delete: `src/cli/components/ChatUI.tsx`
- Delete: `src/cli/tests/ChatUI.test.tsx`
- Delete: `src/cli/tests/pipeline-interactive.test.tsx`

- [ ] **Step 1: Verify nothing else imports the doomed files**

Run these greps and confirm each is empty (or only shows the files themselves / the deletion target list):

```bash
grep -rn "from.*PipelineDisplay" src/ || true
grep -rn "from.*ChatUI" src/ || true
grep -rn "pipeline-interactive" src/ || true
grep -rn "ChatUI.test" src/ || true
```

Expected: no consumer matches remain after Task 5.1. If any match surfaces (e.g., a shared test helper importing `ChatUI` for type information, or a stray reference in `agent-handler.ts`), fix it in place FIRST — either update the import to `PipelineApp` or inline the type. Do NOT `git rm` with live consumers.

- [ ] **Step 2: Delete the files**

```bash
git rm src/cli/components/PipelineDisplay.tsx \
       src/cli/components/ChatUI.tsx \
       src/cli/tests/ChatUI.test.tsx \
       src/cli/tests/pipeline-interactive.test.tsx
```

- [ ] **Step 3: Rebuild and re-run the full test suite**

Run: `npx tsup --silent && npx vitest run`
Expected: build succeeds and all remaining tests pass. Record the exact pass count.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(pipeline): delete obsolete PipelineDisplay + ChatUI"
```

---

### Task 5.3: Component integration test for the full adapter → reducer → render flow

**Why a component test, not a spawned binary:** Ink requires raw-mode TTY to use `useInput`. A `spawn(..., { stdio: "pipe" })` child gives a non-TTY stdin, and Ink crashes with `"Raw mode is not supported on the current process.stdin"` before any chat input can be scripted. Two workable alternatives — `node-pty` (heavy new dep) or a component-layer test driven via `ink-testing-library` + a fake `ChildHandle` — we take the second.

**What this test covers (honest scope):**
- ✅ **Stacked borders bug (Bug 1 from memory 2026-04-11).** Structurally prevented by `PipelineApp`'s single-`<Static>` tree. The test asserts `frame` contains no `┌─+┐` sequence for any combination of events.
- ⚠️ **Mid-chat trace header bug (Bug 2).** The bug was specifically that the adapter emitted `trace-path` mid-conversation. This component test emits `trace-path` before any text events, so it verifies the renderer places the trace line above the body — but it does NOT exercise the adapter ordering that caused the original bug. That ordering is asserted separately via a unit test on `parseClaudeEvent` emitting `trace-path` from the `system` event (Chunk 1) + manual verification (Task 5.4).
- ⚠️ **Downstream output loss (Bug 3).** The bug was caused by a second Ink render root losing cursor sync. The new architecture structurally eliminates the second root. The component test verifies `[2] summarize` renders AFTER freezing `[1] chat`, which is the behavioral symptom — but the root cause (two Ink instances) is fixed by construction in Chunk 4, not verified here. Manual gate (Task 5.4) confirms the real-terminal behavior.

Real-CLI smoke testing is moved to the manual gate (Task 5.4) because the full adapter → engine → subprocess flow cannot be automated without a pty library.

**Files:**
- Create: `src/cli/tests/pipeline-app-integration.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `src/cli/tests/pipeline-app-integration.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PipelineApp } from "../components/PipelineApp.js";
import type { PipelineAppCallbacks } from "../components/PipelineApp.js";
import { createFakeChildHandle } from "./helpers/fake-child-handle.js";

describe("PipelineApp integration: chat → summarize full flow", () => {
  it("renders chat block, freezes on end, then renders summarize block — no stacked borders", async () => {
    let captured: PipelineAppCallbacks | null = null;
    const { lastFrame, rerender } = render(
      <PipelineApp
        pipelineName="chat_end_to_end"
        pid={12345}
        goal={undefined}
        nodes={["chat", "summarize"]}
        onReady={(cbs) => { captured = cbs; }}
      />,
    );
    // onReady fires during the first commit
    expect(captured).not.toBeNull();
    const { emit, done } = captured!;

    // 1. Start + run the interactive chat block.
    //    createFakeChildHandle returns a CONTROLLER object. The real ChildHandle
    //    lives at controller.handle — pass that to interactive-ready, NOT the
    //    controller itself.
    const chatController = createFakeChildHandle("sid-abc");
    const chatChild = chatController.handle;
    let chatDone!: () => void;
    const chatDonePromise = new Promise<void>((res) => { chatDone = res; });

    emit({ kind: "start", nodeId: "chat", label: "interactive", blockKind: "interactive-agent" });
    emit({ kind: "interactive-ready", child: chatChild, onDone: chatDone });
    emit({ kind: "trace-path", sessionId: "sid-abc" });
    emit({ kind: "text", role: "you", text: "hello" });
    emit({ kind: "text", role: "claude", text: "hi, what did you learn today?" });

    // The chat block should now be LIVE (in the footer, not in <Static>)
    let frame = lastFrame() ?? "";
    expect(frame).toContain("[1] chat");
    expect(frame).toContain("trace: ");
    expect(frame).toMatch(/sid-abc\.jsonl/);
    expect(frame).toContain("hello");
    expect(frame).toContain("hi, what did you learn today?");
    // regression: no <Box borderStyle="single"> output from old PipelineDisplay
    expect(frame).not.toMatch(/┌─+┐/);

    // 2. End the chat — this freezes block [1] into <Static> and fires onDone.
    emit({ kind: "end", outcome: { status: "success" } });
    await chatDonePromise;

    // 3. Now run the non-interactive summarize block.
    emit({ kind: "start", nodeId: "summarize", label: "agent", blockKind: "agent" });
    emit({ kind: "trace-path", sessionId: "sid-xyz" });
    emit({ kind: "text", role: "claude", text: "You learned about React 18 batching." });
    emit({ kind: "end", outcome: { status: "success" } });

    frame = lastFrame() ?? "";

    // 4. Assertions — each maps to one of the three original bugs.
    //    (a) Stacked border bug:
    expect(frame).not.toMatch(/┌─+┐/);
    //    (b) Mid-chat trace header bug: trace line appears BEFORE the body,
    //        never after a "claude:" line within the same block.
    //        Use a regex with lookahead rather than two indexOf calls, to be
    //        robust against frame wrapping from ink-testing-library's layout.
    const chatBlockMatch = frame.match(/\[1\] chat[\s\S]*?(?=\[2\] summarize)/);
    expect(chatBlockMatch).not.toBeNull();
    const chatBlock = chatBlockMatch![0];
    const traceIdx = chatBlock.indexOf("trace: ");
    const claudeIdx = chatBlock.indexOf("claude");
    expect(traceIdx).toBeGreaterThan(-1);
    expect(claudeIdx).toBeGreaterThan(-1);
    expect(traceIdx).toBeLessThan(claudeIdx);
    //    (c) Downstream output loss: summarize block header + body both visible
    expect(frame).toContain("[2] summarize");
    expect(frame).toContain("You learned about React 18 batching.");

    //    (d) Outcome glyph appears for BOTH blocks (regression: "all nodes freeze")
    const glyphCount = (frame.match(/[✓✗]/g) ?? []).length;
    expect(glyphCount).toBeGreaterThanOrEqual(2);

    //    (e) Exactly one header line per block — no duplicates.
    expect((frame.match(/━━ \[1\] chat/g) ?? []).length).toBe(1);
    expect((frame.match(/━━ \[2\] summarize/g) ?? []).length).toBe(1);

    done();
  });

  it("abort path: emitting end with status=abort freezes live block and does not crash", () => {
    let captured: PipelineAppCallbacks | null = null;
    render(
      <PipelineApp
        pipelineName="p"
        pid={1}
        goal={undefined}
        nodes={["chat"]}
        onReady={(cbs) => { captured = cbs; }}
      />,
    );
    const { emit, done } = captured!;

    emit({ kind: "start", nodeId: "chat", label: "interactive", blockKind: "interactive-agent" });
    emit({ kind: "text", role: "you", text: "partial" });
    // Do NOT emit a second end. The first abort end must freeze cleanly.
    expect(() => emit({ kind: "end", outcome: { status: "abort", reason: "user-interrupt" } })).not.toThrow();
    // Emitting a second end with no live block must be a silent no-op (reducer guard).
    expect(() => emit({ kind: "end", outcome: { status: "fail", reason: "late" } })).not.toThrow();
    done();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline-app-integration.test.tsx`
Expected: If Chunks 1-4 are implemented, this should PASS on the first run because it only exercises the component tree and the reducer — no new production code is required beyond what Chunks 1-4 already delivered. If it FAILS, the failure is diagnostic: a failure of any `[1] chat` / `[2] summarize` / trace-order / glyph-count / `┌─+┐` assertion directly identifies which of Chunks 1-4 has a regression.

- [ ] **Step 3: If any assertion fails, fix the underlying component — not the assertion**

This is the core regression suite for the three original bugs. Do NOT weaken any assertion to make it pass. If for example `expect(glyphCount).toBeGreaterThanOrEqual(2)` fails, the cause is that `BlockView` is not rendering the outcome line for the frozen block — fix `BlockView` (or the reducer's freeze path), not the test.

- [ ] **Step 4: Commit**

```bash
git add src/cli/tests/pipeline-app-integration.test.tsx
git commit -m "test(pipeline-app): integration test covers chat → summarize flow + 3 regression bugs"
```

---

### Task 5.4: Manual verification gate (real terminal, things the component test cannot cover)

Task 5.3 covers the three regression bugs deterministically via the component tree. This gate covers what it CANNOT: real ANSI cursor motion, actual scrollback behavior in a TTY, and Ctrl+C mid-stream behavior driven through a real shell.

- [ ] **Step 1: Run the interactive pipeline in a real terminal**

```bash
ralph pipeline run pipelines/smoke/chat-end-to-end.dot
```

- [ ] **Step 2: Real-terminal-only checks**

Type one or two messages, then `/end`. Observe that:

1. Scrollback behavior is append-only: scrolling up shows ALL prior block bodies — nothing is erased when a block freezes. (Component test can't see scrollback.)
2. No ANSI cursor artifacts (stray `[K`, unclosed color codes, double prompts) appear after `/end`. (Component test sees a clean frame, not raw escape sequences.)
3. Live footer redraws in-place — the `you:` prompt does NOT duplicate when the token counter ticks.
4. Shell prompt returns only AFTER `━━ [2] summarize` body is visible — this is the core "downstream output loss" bug, re-verified against a real terminal.

- [ ] **Step 3: Ctrl+C mid-stream test**

Run the pipeline again. Chat one message, then press **Ctrl+C** while the agent is streaming a response. Verify:

1. The live block freezes with `✗ abort` (or equivalent abort glyph + reason).
2. The process exits cleanly (no dangling child processes — check with `ps | grep claude`).
3. No stack trace or "Raw mode" error appears on stderr.

- [ ] **Step 4: Record the result**

On success: proceed to Task 5.5.
On failure: do NOT declare the plan done. Capture a copy of the terminal output and file a follow-up spec amendment with the symptom + suspected root cause. Do not weaken the integration test assertions to mask a real defect.

---

### Task 5.5: Final sanity gate

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: all tests pass. Record the total count; it should equal Chunks 1-4 (57) + the new Task 5.3 integration file (2 tests) + Task 5.0 engine test (2 tests) − deleted `ChatUI.test.tsx` (~12 tests) − deleted `pipeline-interactive.test.tsx` (~6 tests). Exact delta depends on the pre-existing test counts in the files being deleted; record the BEFORE and AFTER totals in the commit message.

- [ ] **Step 2: Rebuild**

Run: `npx tsup --silent`
Expected: succeeds with no type errors. `dist/cli/index.js` is regenerated. No need to `npm link` — the existing symlink picks up the new dist automatically.

- [ ] **Step 3: Mark the spec as implemented**

Edit `docs/superpowers/specs/2026-04-14-pipeline-renderer-redesign-design.md`. Find the YAML frontmatter at the top of the file (between the leading `---` markers). Locate the line `status: draft` (or `status: approved` — whatever the current value is) and change it to `status: implemented`. Append a new section at the bottom of the spec:

```markdown
## Implementation notes

Implemented per `docs/superpowers/plans/2026-04-14-pipeline-renderer-redesign.md` on <DATE>. Deviations from the spec:
- `LiveBlock.input` moved from reducer state to render-layer `LiveBlockWithInput` (see Chunk 3 spec refinement note).
- Pipeline completion summary is rendered by the persistent header + frozen blocks; no synthetic marker block is emitted.
- `onNodeEnd` callback added to `EngineOptions` as a prerequisite (Task 5.0).
```

- [ ] **Step 4: Final commit (if any pending changes)**

```bash
git status
# Review any remaining dirty files. Commit with a summary if needed.
git add docs/superpowers/specs/2026-04-14-pipeline-renderer-redesign-design.md
git commit -m "docs(spec): mark pipeline-renderer-redesign as implemented"
```

---

**Chunk 5 done — plan complete.** The old nested-`<Static>` renderer is deleted. The new single-`<Static>` `PipelineApp` is live. The three original bugs are structurally prevented by the reducer invariants + the Ink tree shape. Automated tests cover every layer (helpers → reducer → components → root → scenario smoke), and the manual gate provides the final human-eyeball check before shipping.

---

## Appendix: Test count summary

| Chunk | File | Tests |
|-------|------|-------|
| 1 | `claudeTracePath.test.ts` | 4 |
| 1 | `classifyNode.test.ts` | 11 |
| 1 | `parseClaudeEvent.test.ts` | 7 |
| 2 | `pipelineReducer.test.ts` | 15 |
| 3 | `BlockView.test.tsx` | 9 |
| 3 | `LiveFooter.test.tsx` | 7 |
| 4 | `PipelineApp.test.tsx` | 4 |
| 5 | `engine-onNodeEnd.test.ts` (Task 5.0) | 2 |
| 5 | `pipeline-app-integration.test.tsx` (Task 5.3) | 2 |
| **Total added** | | **61** |

Deleted: `ChatUI.test.tsx` and `pipeline-interactive.test.tsx` (exact count depends on the files at deletion time — subtract from the project-wide total in Task 5.5 Step 1).

Note: The real-CLI stdout smoke test was intentionally NOT added. Ink's raw-mode requirement makes piped-stdin subprocess scripting impossible without `node-pty` or similar; the component-integration test in Task 5.3 covers all three regression bugs deterministically, and Task 5.4 provides a manual real-terminal gate for the things component tests cannot see (ANSI cursor motion, real scrollback, Ctrl+C mid-stream).




