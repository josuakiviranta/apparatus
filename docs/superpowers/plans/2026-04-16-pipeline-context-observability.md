---
status: implemented
---

# Pipeline Context Observability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the context each pipeline node receives from upstream nodes visible — via a `received context:` line in the TUI and a `ralph pipeline trace` CLI command that reads a unified per-run JSONL trace file.

**Architecture:** A new `PipelineTracer` interface is injected into the engine via `EngineOptions.traceWriter`. The engine generates a unique `nodeReceiveId` per node invocation, calls the tracer at node boundaries, and passes the ID to `onNodeStart`. `JsonlPipelineTracer` writes events to `~/.ralph/runs/<runId>/pipeline.jsonl`. The TUI adds a `received-context` static item per node block. A new `ralph pipeline trace` subcommand reads the trace file.

**Tech Stack:** TypeScript, Node.js `fs` (appendFileSync, mkdirSync), Vitest, Ink (React for terminals), Commander

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/attractor/tracer/pipeline-tracer.ts` | Create | `PipelineTracer` interface |
| `src/attractor/tracer/jsonl-pipeline-tracer.ts` | Create | `JsonlPipelineTracer` — writes pipeline.jsonl |
| `src/attractor/tracer/jsonl-pipeline-tracer.test.ts` | Create | Unit tests for JsonlPipelineTracer |
| `src/attractor/core/engine.ts` | Modify | Add `traceWriter` to `EngineOptions`, generate `nodeReceiveId`, call tracer |
| `src/attractor/tests/engine.test.ts` | Modify | Add tests for tracer callbacks |
| `src/cli/lib/pipelineEvents.ts` | Modify | Add `nodeReceiveId` + `hasContext` to `start` event |
| `src/cli/components/PipelineApp.tsx` | Modify | Add `received-context` StaticItem, `runId` prop, run trace path in header |
| `src/cli/commands/pipeline.ts` | Modify | Wire `JsonlPipelineTracer`, pass `runId` to PipelineApp, add `trace` subcommand |

---

## Chunk 1: PipelineTracer Interface + JsonlPipelineTracer

### Task 1: PipelineTracer interface

**Files:**
- Create: `src/attractor/tracer/pipeline-tracer.ts`

- [ ] **Step 1: Create the interface file**

```typescript
// src/attractor/tracer/pipeline-tracer.ts
import type { Graph, Node, PipelineContext, Outcome } from "../types.js";

export interface PipelineTracer {
  onPipelineStart(meta: { runId: string; graph: Graph; ctx: PipelineContext }): void;
  onNodeStart(meta: { nodeReceiveId: string; node: Node; ctx: PipelineContext }): void;
  onNodeEnd(meta: { nodeReceiveId: string; node: Node; outcome: Outcome }): void;
  onPipelineEnd(meta: { runId: string; outcome: "success" | "failure" }): void;
}
```

- [ ] **Step 2: Build to confirm no type errors**

Run: `npm run build 2>&1 | head -20`
Expected: No errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tracer/pipeline-tracer.ts
git commit -m "feat: add PipelineTracer interface"
```

---

### Task 2: JsonlPipelineTracer

**Files:**
- Create: `src/attractor/tracer/jsonl-pipeline-tracer.ts`
- Create: `src/attractor/tracer/jsonl-pipeline-tracer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/attractor/tracer/jsonl-pipeline-tracer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { JsonlPipelineTracer } from "./jsonl-pipeline-tracer.js";
import type { Graph, Node, PipelineContext, Outcome } from "../types.js";

function makeGraph(): Graph {
  return { goal: "test", nodes: [{ id: "run", type: "codergen" } as Node], edges: [] } as unknown as Graph;
}
function makeNode(id: string): Node {
  return { id, type: "codergen" } as Node;
}
function makeCtx(values: Record<string, unknown> = {}): PipelineContext {
  return { values };
}
function makeOutcome(success: boolean): Outcome {
  return { success, contextUpdates: { "run.success": String(success) } } as Outcome;
}

describe("JsonlPipelineTracer", () => {
  let dir: string;
  let tracePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ralph-tracer-test-"));
    tracePath = join(dir, "pipeline.jsonl");
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  function readLines(): Array<Record<string, unknown>> {
    return readFileSync(tracePath, "utf-8")
      .trim()
      .split("\n")
      .map(l => JSON.parse(l));
  }

  it("creates the trace file and writes pipeline-start event", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onPipelineStart({ runId: "abc123", graph: makeGraph(), ctx: makeCtx() });
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("pipeline-start");
    expect(lines[0].runId).toBe("abc123");
    expect(lines[0].goal).toBe("test");
    expect(lines[0].nodes).toEqual(["run"]);
    expect(typeof lines[0].timestamp).toBe("string");
  });

  it("writes node-start event with contextSnapshot", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    const ctx = makeCtx({ "run.output": "some output", "run.success": "true" });
    tracer.onNodeStart({ nodeReceiveId: "summarize-4f8c", node: makeNode("summarize"), ctx });
    const lines = readLines();
    expect(lines[0].kind).toBe("node-start");
    expect(lines[0].nodeReceiveId).toBe("summarize-4f8c");
    expect(lines[0].nodeId).toBe("summarize");
    expect(lines[0].contextSnapshot).toEqual({ "run.output": "some output", "run.success": "true" });
  });

  it("writes node-end event with contextUpdates", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onNodeEnd({
      nodeReceiveId: "run-1a3d",
      node: makeNode("run"),
      outcome: makeOutcome(true),
    });
    const lines = readLines();
    expect(lines[0].kind).toBe("node-end");
    expect(lines[0].nodeReceiveId).toBe("run-1a3d");
    expect(lines[0].success).toBe(true);
    expect(lines[0].contextUpdates).toEqual({ "run.success": "true" });
  });

  it("writes pipeline-end event", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onPipelineEnd({ runId: "abc123", outcome: "success" });
    const lines = readLines();
    expect(lines[0].kind).toBe("pipeline-end");
    expect(lines[0].outcome).toBe("success");
  });

  it("appends events sequentially (full pipeline sequence)", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onPipelineStart({ runId: "abc123", graph: makeGraph(), ctx: makeCtx() });
    tracer.onNodeStart({ nodeReceiveId: "run-1a3d", node: makeNode("run"), ctx: makeCtx() });
    tracer.onNodeEnd({ nodeReceiveId: "run-1a3d", node: makeNode("run"), outcome: makeOutcome(true) });
    tracer.onPipelineEnd({ runId: "abc123", outcome: "success" });
    const lines = readLines();
    expect(lines).toHaveLength(4);
    expect(lines.map(l => l.kind)).toEqual([
      "pipeline-start", "node-start", "node-end", "pipeline-end"
    ]);
  });

  it("creates parent directory if it does not exist", () => {
    const nestedPath = join(dir, "nested", "deep", "pipeline.jsonl");
    const tracer = new JsonlPipelineTracer(nestedPath);
    tracer.onPipelineEnd({ runId: "x", outcome: "failure" });
    const lines = readFileSync(nestedPath, "utf-8").trim().split("\n").map(l => JSON.parse(l));
    expect(lines[0].kind).toBe("pipeline-end");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tracer/jsonl-pipeline-tracer.test.ts 2>&1 | tail -10`
Expected: FAIL — `Cannot find module './jsonl-pipeline-tracer.js'`

- [ ] **Step 3: Implement JsonlPipelineTracer**

```typescript
// src/attractor/tracer/jsonl-pipeline-tracer.ts
import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { PipelineTracer } from "./pipeline-tracer.js";
import type { Graph, Node, PipelineContext, Outcome } from "../types.js";

export class JsonlPipelineTracer implements PipelineTracer {
  constructor(private tracePath: string) {
    mkdirSync(dirname(tracePath), { recursive: true });
  }

  onPipelineStart({ runId, graph, ctx }: { runId: string; graph: Graph; ctx: PipelineContext }): void {
    this.append({
      kind: "pipeline-start",
      runId,
      goal: graph.goal,
      nodes: graph.nodes.map(n => n.id),
      timestamp: new Date().toISOString(),
    });
  }

  onNodeStart({ nodeReceiveId, node, ctx }: { nodeReceiveId: string; node: Node; ctx: PipelineContext }): void {
    this.append({
      kind: "node-start",
      nodeReceiveId,
      nodeId: node.id,
      nodeKind: node.type,
      timestamp: new Date().toISOString(),
      contextSnapshot: ctx.values,
    });
  }

  onNodeEnd({ nodeReceiveId, node, outcome }: { nodeReceiveId: string; node: Node; outcome: Outcome }): void {
    this.append({
      kind: "node-end",
      nodeReceiveId,
      nodeId: node.id,
      success: outcome.success,
      contextUpdates: outcome.contextUpdates ?? {},
    });
  }

  onPipelineEnd({ runId, outcome }: { runId: string; outcome: "success" | "failure" }): void {
    this.append({
      kind: "pipeline-end",
      runId,
      outcome,
      timestamp: new Date().toISOString(),
    });
  }

  private append(event: object): void {
    appendFileSync(this.tracePath, JSON.stringify(event) + "\n");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/attractor/tracer/jsonl-pipeline-tracer.test.ts 2>&1 | tail -15`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/attractor/tracer/pipeline-tracer.ts src/attractor/tracer/jsonl-pipeline-tracer.ts src/attractor/tracer/jsonl-pipeline-tracer.test.ts
git commit -m "feat: add JsonlPipelineTracer — writes pipeline.jsonl trace"
```

---

## Chunk 2: Engine Changes

### Task 3: Add traceWriter to EngineOptions and call tracer at node boundaries

**Files:**
- Modify: `src/attractor/core/engine.ts`
- Modify: `src/attractor/tests/engine.test.ts`

The engine currently has `onNodeStart?: (node: Node) => void` at line 29. This needs to gain a second `meta` argument. Callers passing one-arg callbacks are unaffected in JS/TS (extra args are ignored), but the type signature must be updated.

- [ ] **Step 1: Write failing test for tracer callbacks**

Add this test to `src/attractor/tests/engine.test.ts` (after existing describe block):

```typescript
import type { PipelineTracer } from "../tracer/pipeline-tracer.js";

// Add inside the existing describe("runPipeline", ...) block:

it("calls traceWriter.onNodeStart and onNodeEnd for each node", async () => {
  const dot = `digraph g {
    start [shape=Mdiamond]
    work  [shape=box, prompt="do work"]
    done  [shape=Msquare]
    start -> work
    work  -> done
  }`;
  const graph = parseDot(dot);

  const tracer: PipelineTracer = {
    onPipelineStart: vi.fn(),
    onNodeStart: vi.fn(),
    onNodeEnd: vi.fn(),
    onPipelineEnd: vi.fn(),
  };

  mockAgentRun.mockResolvedValueOnce({ exitCode: 0, sessionId: "s1", stdout: null });
  await runPipeline(graph, makeOpts(dir, { traceWriter: tracer }));

  expect(tracer.onPipelineStart).toHaveBeenCalledOnce();
  expect(tracer.onPipelineEnd).toHaveBeenCalledOnce();

  // onNodeStart called for start, work, done (3 nodes)
  expect(tracer.onNodeStart).toHaveBeenCalledTimes(3);
  // All calls include nodeReceiveId with pattern <nodeId>-<4hexchars>
  const startCalls = (tracer.onNodeStart as ReturnType<typeof vi.fn>).mock.calls;
  for (const [meta] of startCalls) {
    expect(meta.nodeReceiveId).toMatch(/^[a-z]+-[0-9a-f]{4}$/);
    expect(meta.node).toBeDefined();
    expect(meta.ctx).toBeDefined();
  }
});

it("passes nodeReceiveId to onNodeStart callback", async () => {
  const dot = `digraph g {
    start [shape=Mdiamond]
    work  [shape=box, prompt="do work"]
    done  [shape=Msquare]
    start -> work
    work  -> done
  }`;
  const graph = parseDot(dot);
  const nodeStartMeta: Array<{ nodeReceiveId: string }> = [];

  mockAgentRun.mockResolvedValueOnce({ exitCode: 0, sessionId: "s1", stdout: null });
  await runPipeline(graph, makeOpts(dir, {
    onNodeStart: (_node, meta) => { nodeStartMeta.push(meta); },
  }));

  expect(nodeStartMeta).toHaveLength(3);
  for (const meta of nodeStartMeta) {
    expect(meta.nodeReceiveId).toMatch(/^[a-z]+-[0-9a-f]{4}$/);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tests/engine.test.ts 2>&1 | tail -15`
Expected: FAIL — `traceWriter` not in EngineOptions, `onNodeStart` missing meta arg

- [ ] **Step 3: Update EngineOptions and engine main loop**

In `src/attractor/core/engine.ts`:

**Change line 29** (onNodeStart signature):
```typescript
// Before:
onNodeStart?: (node: Node) => void;
// After:
onNodeStart?: (node: Node, meta: { nodeReceiveId: string }) => void;
```

**Add after line 34** (after onNodeEnd):
```typescript
traceWriter?: import("../tracer/pipeline-tracer.js").PipelineTracer;
```

**Update the existing crypto import** (line 3 already has `import { randomUUID } from "crypto"`):
```typescript
// Before:
import { randomUUID } from "crypto";
// After:
import { randomUUID, randomBytes } from "crypto";
```
Do NOT add a second `import ... from "crypto"` line — merge into the existing one.

**In `runPipeline`, find where `opts.onNodeStart?.(node)` is called** (search for `onNodeStart` in the function body). The call pattern is currently:

```typescript
opts.onNodeStart?.(node);
```

Replace with:
```typescript
const nodeReceiveId = `${node.id}-${randomBytes(2).toString("hex")}`;
opts.traceWriter?.onNodeStart({ nodeReceiveId, node, ctx: { values: context } });
opts.onNodeStart?.(node, { nodeReceiveId });
```

**Find where `opts.onNodeEnd?.(node, outcome)` is called** and wrap it:
```typescript
opts.traceWriter?.onNodeEnd({ nodeReceiveId, node, outcome });
opts.onNodeEnd?.(node, outcome);
```

Note: `nodeReceiveId` must be declared before the handler executes and referenced after. If the handler call and the onNodeEnd call are not in the same block, use a `let nodeReceiveId: string` declared before the handler block.

The tracer + callback calls must happen for **every** node the loop processes, including start and exit nodes. Place the `nodeReceiveId` generation and `traceWriter.onNodeStart` call at the top of the loop body, before any early-exit checks (like `if (isExitNode(...)) break`). Similarly, `traceWriter.onNodeEnd` must fire before the break. The test expects 3 calls (start, work, done) — this is only achievable if exit nodes are traced before break.

**At pipeline start** (after context is initialized, before the main while loop):
```typescript
// Note: context["run_id"] is never seeded by the engine — randomUUID() is always the fallback.
// This runId is used only for trace file naming; it does not need to match context["run_id"].
const runId = randomUUID();
opts.traceWriter?.onPipelineStart({ runId, graph, ctx: { values: context } });
```

**At pipeline end** (before each `return` in `runPipeline`):
```typescript
opts.traceWriter?.onPipelineEnd({ runId, outcome: result.status === "success" ? "success" : "failure" });
return result;
```

Because there are multiple return paths in the engine, create a helper to avoid duplication:

```typescript
function finalize(result: PipelineResult, opts: EngineOptions, runId: string): PipelineResult {
  opts.traceWriter?.onPipelineEnd({
    runId,
    outcome: result.status === "success" ? "success" : "failure",
  });
  return result;
}
```

Then replace all `return { status: ..., ... }` with `return finalize({ status: ..., ... }, opts, runId)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/attractor/tests/engine.test.ts 2>&1 | tail -20`
Expected: All tests PASS including the two new ones

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/attractor/core/engine.ts src/attractor/tests/engine.test.ts
git commit -m "feat: add traceWriter to engine — nodeReceiveId per invocation"
```

---

## Chunk 3: TUI Changes

### Task 4: Extend NodeEvent start + add received-context StaticItem to PipelineApp

**Files:**
- Modify: `src/cli/lib/pipelineEvents.ts`
- Modify: `src/cli/components/PipelineApp.tsx`

First, read both files to understand exact current shapes before editing.

- [ ] **Step 1: Read current pipelineEvents.ts**

Read `src/cli/lib/pipelineEvents.ts` in full. Locate the `start` event kind definition. It currently looks like:
```typescript
| { kind: "start"; nodeId: string; label: string; blockKind: BlockKind }
```

- [ ] **Step 2: Extend the start event**

Add `nodeReceiveId: string` and `hasContext: boolean` to the `start` event:
```typescript
| { kind: "start"; nodeId: string; label: string; blockKind: BlockKind; nodeReceiveId: string; hasContext: boolean }
```

- [ ] **Step 3: Build to find all callers of start event that need updating**

Run: `npm run build 2>&1 | grep "error"`
Expected: Type errors at every place that constructs a `start` event without the new fields. These will be in `src/cli/commands/pipeline.ts`.

- [ ] **Step 4: Read current PipelineApp.tsx**

Read `src/cli/components/PipelineApp.tsx` in full. Note:
- The `StaticItem` union type (around line 27-33)
- The `Props` interface (around line 17-23) — does NOT currently have `runId`
- The block-open append logic (around line 111-114)
- The block-open render logic (around line 217-220)

- [ ] **Step 5: Add received-context to StaticItem union**

In `PipelineApp.tsx`, extend the `StaticItem` union:
```typescript
// Add this line to the StaticItem union:
| { kind: "received-context"; id: string; nodeReceiveId: string; runId: string; hasContext: boolean }
```

- [ ] **Step 6: Add runId to Props**

In `PipelineApp.tsx`, extend the `Props` interface:
```typescript
interface Props {
  pipelineName: string;
  pid: number;
  goal?: string;
  nodes: string[];
  runId: string;         // new
  tracePath: string;     // new — path to pipeline.jsonl, shown in header
  onReady: (cbs: PipelineAppCallbacks) => void;
}
```

- [ ] **Step 7: Update props destructure and block-open append**

`PipelineApp` destructures props at the function signature (e.g. `function PipelineApp({ pipelineName, pid, goal, nodes, onReady }: Props)`). Add `runId` and `tracePath` to the destructure:

```typescript
// Before:
function PipelineApp({ pipelineName, pid, goal, nodes, onReady }: Props)
// After:
function PipelineApp({ pipelineName, pid, goal, nodes, runId, tracePath, onReady }: Props)
```

Then find the `setStaticItems` call that appends `block-open` on a `start` event (around line 111-114). Replace it with:

```typescript
setStaticItems(prev => [
  ...prev,
  { kind: "block-open", id, displayIndex, nodeId: event.nodeId, label: event.label },
  {
    kind: "received-context",
    id: `${id}-ctx`,
    nodeReceiveId: event.nodeReceiveId,
    runId,
    hasContext: event.hasContext,
  },
]);
```

- [ ] **Step 8: Add received-context render branch**

Find the block-open render branch (around line 217-220). After it, add:

```typescript
if (item.kind === "received-context") {
  const cmd = `ralph pipeline trace ${item.runId} --node-receive ${item.nodeReceiveId}`;
  const suffix = item.hasContext ? "" : "  (empty)";
  return (
    <Text key={item.id} dimColor>
      {"  received context: "}
      <Text dimColor={false}>{cmd}</Text>
      {suffix}
    </Text>
  );
}
```

- [ ] **Step 9: Update pipeline header to show trace path**

Three changes required:

**9a.** Add `tracePath` to the `header` variant of the `StaticItem` union:
```typescript
// Before:
| { kind: "header"; id: string; pipelineName: string; pid: number; goal?: string; nodes: string[] }
// After:
| { kind: "header"; id: string; pipelineName: string; pid: number; goal?: string; nodes: string[]; tracePath: string }
```

**9b.** Find the `header` static item creation (the initial `setStaticItems` call on mount that appends the header). Add `tracePath` to it:
```typescript
{ kind: "header", id: "header", pipelineName, pid, goal, nodes, tracePath }
```

**9c.** In the header render branch, after the nodes line, add:
```typescript
<Text dimColor>{` run:   `}<Text dimColor={false}>{item.tracePath}</Text></Text>
```

- [ ] **Step 10: Build to verify**

Run: `npm run build 2>&1 | grep "error"`
Expected: Errors in `pipeline.ts` only (missing `runId`, `tracePath`, updated `start` event fields). These are fixed in Chunk 4.

- [ ] **Step 11: Commit**

```bash
git add src/cli/lib/pipelineEvents.ts src/cli/components/PipelineApp.tsx
git commit -m "feat: add received-context static item to TUI block-open"
```

---

## Chunk 4: Pipeline Command Wiring + Trace Subcommand

### Task 5: Wire JsonlPipelineTracer in pipeline.ts and fix start event callers

**Files:**
- Modify: `src/cli/commands/pipeline.ts`

First, read `src/cli/commands/pipeline.ts` in full to understand existing structure before editing.

- [ ] **Step 1: Read pipeline.ts**

Read `src/cli/commands/pipeline.ts` in full. Identify:
- Where `runPipeline` is called and how `EngineOptions` is constructed
- Where `PipelineApp` is rendered and how props are passed
- Where `onNodeStart` is currently used
- How `run_id` is set in context (if at all before `runPipeline` is called)
- Where the Commander program/command is defined for `pipeline`

- [ ] **Step 2: Determine runId**

The engine sets `run_id` in context at init (via `ctx.values.run_id`). However, `pipeline.ts` needs the `runId` BEFORE calling `runPipeline` to construct the tracer path. Add a `runId` generation at the start of the run handler:

```typescript
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { JsonlPipelineTracer } from "../../attractor/tracer/jsonl-pipeline-tracer.js";

// At the start of the run action handler (before PipelineApp render):
const runId = randomUUID().slice(0, 8);  // short 8-char ID for readability
const tracePath = join(homedir(), ".ralph", "runs", runId, "pipeline.jsonl");
const tracer = new JsonlPipelineTracer(tracePath);
```

Note: The engine also sets `run_id` in context. Pass `runId` explicitly rather than relying on the context value to avoid a chicken-and-egg problem.

- [ ] **Step 3: Pass tracer to runPipeline**

In the `EngineOptions` object passed to `runPipeline`, add:
```typescript
traceWriter: tracer,
```

- [ ] **Step 4: Fix onNodeStart to pass nodeReceiveId to emit**

The `onNodeStart` callback needs `hasContext` (whether the node received any upstream context). The engine's `traceWriter.onNodeStart` is called with the full context snapshot BEFORE `opts.onNodeStart` is called (per Chunk 2 ordering). Use a wrapper tracer to capture the latest context snapshot for use in the callback:

```typescript
// Declare before runPipeline call:
const jsonlTracer = new JsonlPipelineTracer(tracePath);
let latestContext: Record<string, unknown> = {};

const tracer: PipelineTracer = {
  onPipelineStart(meta) { jsonlTracer.onPipelineStart(meta); },
  onNodeStart(meta) {
    latestContext = meta.ctx.values;   // capture before callback fires
    jsonlTracer.onNodeStart(meta);
  },
  onNodeEnd(meta) { jsonlTracer.onNodeEnd(meta); },
  onPipelineEnd(meta) { jsonlTracer.onPipelineEnd(meta); },
};
```

Then update the existing `onNodeStart` callback (find it in pipeline.ts from Step 1 read) to:
```typescript
onNodeStart: (node, { nodeReceiveId }) => {
  emit({
    kind: "start",
    nodeId: node.id,
    label: node.label ?? node.id,
    blockKind: resolveBlockKind(node),  // existing call — keep as-is
    nodeReceiveId,
    hasContext: Object.keys(latestContext).length > 0,
  });
},
```

Pass `tracer` (not `jsonlTracer`) as `traceWriter` to `runPipeline`.

- [ ] **Step 5: Pass runId and tracePath to PipelineApp**

Update the `PipelineApp` render call to include:
```tsx
<PipelineApp
  // ...existing props...
  runId={runId}
  tracePath={tracePath}
  onReady={...}
/>
```

Also update the `header` static item creation inside `PipelineApp` to include `tracePath`. Since `PipelineApp` now receives `tracePath` as a prop, the header append (which happens on mount) uses it:

```typescript
// In the useEffect/initial staticItems setup for the header:
{ kind: "header", id: "header", pipelineName, pid, goal, nodes, tracePath }
```

- [ ] **Step 6: Build to verify no type errors**

Run: `npm run build 2>&1 | grep "error"`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/pipeline.ts
git commit -m "feat: wire JsonlPipelineTracer in pipeline command"
```

---

### Task 6: Add ralph pipeline trace subcommand

**Files:**
- Modify: `src/cli/commands/pipeline.ts`

- [ ] **Step 1: Add the trace subcommand to the pipeline Commander command**

In `pipeline.ts`, find where the pipeline Commander command is registered. Add a `trace` subcommand after the existing `run` subcommand:

```typescript
pipelineCmd
  .command("trace <runId>")
  .description("inspect a pipeline run trace")
  .option("--node-receive <nodeReceiveId>", "show context snapshot for a specific node invocation")
  .action(async (runId: string, opts: { nodeReceive?: string }) => {
    const tracePath = join(homedir(), ".ralph", "runs", runId, "pipeline.jsonl");

    let raw: string;
    try {
      raw = readFileSync(tracePath, "utf-8");
    } catch {
      console.error(`No trace found for run: ${runId}`);
      console.error(`Expected: ${tracePath}`);
      process.exit(1);
    }

    const lines = raw.trim().split("\n").map(l => JSON.parse(l) as Record<string, unknown>);

    if (opts.nodeReceive) {
      // Show context snapshot for specific node invocation
      const event = lines.find(
        l => l.kind === "node-start" && l.nodeReceiveId === opts.nodeReceive
      );
      if (!event) {
        console.error(`No node-start event found for: ${opts.nodeReceive}`);
        process.exit(1);
      }
      const snapshot = (event.contextSnapshot as Record<string, unknown>) ?? {};
      const keys = Object.keys(snapshot);

      // Find completed stages (all node-end events before this node-start)
      const thisIdx = lines.indexOf(event);
      const completedStages = lines
        .slice(0, thisIdx)
        .filter(l => l.kind === "node-end" && l.success === true)
        .map(l => String(l.nodeId));

      console.log(`\nnode:     ${event.nodeId}`);
      console.log(`kind:     ${event.nodeKind}`);
      console.log(`received: ${event.timestamp}`);
      console.log(`\ncontext snapshot (${keys.length} key${keys.length === 1 ? "" : "s"}):`);
      if (keys.length === 0) {
        console.log("  (empty — first node)");
      } else {
        const maxLen = Math.max(...keys.map(k => k.length));
        for (const key of keys) {
          const val = JSON.stringify(snapshot[key]);
          const truncated = val.length > 80 ? val.slice(0, 77) + "..." : val;
          console.log(`  ${key.padEnd(maxLen + 2)}${truncated}`);
        }
      }
      console.log(`\ncompleted stages: ${completedStages.length > 0 ? completedStages.join(" · ") : "(none)"}`);
      console.log();
      return;
    }

    // List all node invocations
    const pipelineStart = lines.find(l => l.kind === "pipeline-start");
    const pipelineEnd = lines.find(l => l.kind === "pipeline-end");
    const nodeStarts = lines.filter(l => l.kind === "node-start");
    const nodeEnds = lines.filter(l => l.kind === "node-end") as Array<Record<string, unknown>>;

    console.log(`\nrun:     ${runId}`);
    console.log(`outcome: ${pipelineEnd?.outcome ?? "in-progress"}`);
    console.log(`nodes:`);

    for (const ns of nodeStarts) {
      const ne = nodeEnds.find(e => e.nodeReceiveId === ns.nodeReceiveId);
      const snapshot = (ns.contextSnapshot as Record<string, unknown>) ?? {};
      const ctxKeys = Object.keys(snapshot);
      const ctxDisplay = ctxKeys.length === 0 ? "{}" : `{${ctxKeys.slice(0, 3).join(", ")}${ctxKeys.length > 3 ? ", ..." : ""}}`;
      const status = ne ? (ne.success ? "✓" : "✗") : "…";
      console.log(`  ${String(ns.nodeReceiveId).padEnd(20)} ${String(ns.nodeId).padEnd(12)} ${String(ns.nodeKind).padEnd(18)} ${status}  ctx: ${ctxDisplay}`);
    }
    console.log();
  });
```

`homedir` and `join` were already added in Task 5. Check whether `readFileSync` is already in the `fs` import added in Task 5. If Task 5 only imported `{ } from "fs"` for the tracer (which uses `appendFileSync`/`mkdirSync` internally), add `readFileSync` to the `pipeline.ts` fs import:

```typescript
// If pipeline.ts has: import { ... } from "fs";
// Add readFileSync to that existing import.
// If there is no fs import yet, add:
import { readFileSync } from "fs";
```

- [ ] **Step 2: Build to verify**

Run: `npm run build 2>&1 | grep "error"`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/pipeline.ts
git commit -m "feat: add ralph pipeline trace subcommand for context inspection"
```

---

## Final Verification

- [ ] **Build + full test suite**

Run: `npm run build && npx vitest run 2>&1 | tail -20`
Expected: Build succeeds, all tests pass

- [ ] **Manual smoke test (optional — requires a running pipeline)**

```bash
npm run build && npm link
ralph pipeline run poc-implement --project ~/poc-test
# After run completes, copy the runId from the header output, then:
ralph pipeline trace <runId>
ralph pipeline trace <runId> --node-receive summarize-<id>
```
Expected: Context snapshot output for downstream nodes shows upstream keys.

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: pipeline context observability — trace file + TUI received-context lines"
```
