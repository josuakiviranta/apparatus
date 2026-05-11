# Mission Control — One Verb with Positional Zoom Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `apparat status` + `apparat watch` + `apparat pipeline list` into a single `apparat status [project] [pipeline] [runId]` verb with positional zoom, a default `running now:` block, and a clean split of `PipelineApp` into live + read-only renderers — old verbs deleted, not aliased.

**Architecture:** New `src/cli/lib/mission-control.ts` owns the cross-projection over `projects-registry` + `runs-index` + `pipeline-status` + daemon `list_tasks`. New `src/cli/lib/mission-control-render.ts` owns four pure zoom-level formatters. `PipelineApp` splits into `<PipelineRunView>` (live + interactive, retains `useInput`/`LiveFooter`/`useApp`) and `<PipelineTraceView>` (read-only `StaticItem` renderer that consumes either a finished `pipeline.jsonl` via `replayTraceIntoApp` or a live one via a new `pipeline-jsonl-tail.ts` `fs.watch` adapter). `apparat watch` and `apparat pipeline list` are deleted outright (no aliases); the `heartbeat watch` deprecation pointer flips to `apparat status`.

**Tech Stack:** TypeScript, Node.js, Commander v12 (optional-positional chains), React/Ink (`<Static>` + `useInput`/`useApp`), Vitest, `fs.watch`.

**Reference design doc:** `docs/superpowers/specs/2026-05-11-mission-control-three-doors-one-room-design.md` (authoritative for architecture, behavior contracts, blast radius).

---

## Chunk 1: Renderer split foundations — `PipelineRunView`, `PipelineTraceView`, JSONL tail

**Intent:** Land the new view modules and the tail adapter as a pure additive change. Nothing yet consumes them; `PipelineApp.tsx`, `WatchApp.tsx`, `apparat watch`, and `apparat pipeline list` are all still alive at end of chunk. Build stays green; behavior unchanged.

### Task 1.1: Extract `mapTraceLineToEvent` to module scope in `replayTraceIntoApp.ts`

**Files:**
- Modify: `src/cli/lib/replayTraceIntoApp.ts`
- Test: `src/cli/tests/replayTraceIntoApp.test.ts` (create or extend if it exists)

The current `replayTraceIntoApp` parses each JSONL line and emits a `NodeEvent` inline. The new `pipeline-jsonl-tail.ts` needs the same line→event mapping. Lift the per-line decision into an exported `mapTraceLineToEvent(line: string): NodeEvent | null`. `replayTraceIntoApp` keeps the file-IO loop and calls the new function per line.

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/replayTraceIntoApp.test.ts` (or add this case if the file exists):

```ts
import { describe, it, expect } from "vitest";
import { mapTraceLineToEvent } from "../lib/replayTraceIntoApp.js";

describe("mapTraceLineToEvent", () => {
  it("maps node-start trace line to a NodeEvent of kind 'start'", () => {
    const line = JSON.stringify({
      kind: "node-start",
      nodeId: "verifier",
      nodeReceiveId: "rcv-1",
      contextSnapshot: { foo: "bar" },
    });
    const ev = mapTraceLineToEvent(line);
    expect(ev).toEqual({
      kind: "start",
      nodeId: "verifier",
      label: "verifier",
      blockKind: "agent",
      nodeReceiveId: "rcv-1",
      hasContext: true,
    });
  });

  it("maps node-end success to a NodeEvent of kind 'end' with success status", () => {
    const line = JSON.stringify({ kind: "node-end", success: true });
    expect(mapTraceLineToEvent(line)).toEqual({
      kind: "end",
      outcome: { status: "success", reason: undefined },
    });
  });

  it("maps node-end failure with failureReason", () => {
    const line = JSON.stringify({
      kind: "node-end", success: false, failureReason: "rubric failed",
    });
    expect(mapTraceLineToEvent(line)).toEqual({
      kind: "end",
      outcome: { status: "fail", reason: "rubric failed" },
    });
  });

  it("returns null for pipeline-start / pipeline-end / validation-failure / unknown kinds", () => {
    expect(mapTraceLineToEvent(JSON.stringify({ kind: "pipeline-start" }))).toBeNull();
    expect(mapTraceLineToEvent(JSON.stringify({ kind: "pipeline-end" }))).toBeNull();
    expect(mapTraceLineToEvent(JSON.stringify({ kind: "validation-failure" }))).toBeNull();
    expect(mapTraceLineToEvent(JSON.stringify({ kind: "node-foo" }))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(mapTraceLineToEvent("{not json")).toBeNull();
    expect(mapTraceLineToEvent("")).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/replayTraceIntoApp.test.ts`
Expected: FAIL — `mapTraceLineToEvent is not a function` (the symbol is not exported yet).

- [x] **Step 3: Refactor `replayTraceIntoApp.ts` — extract the per-line mapper**

Replace the body of `src/cli/lib/replayTraceIntoApp.ts` with:

```ts
// src/cli/lib/replayTraceIntoApp.ts
import { readFileSync, existsSync } from "fs";
import type { NodeEvent } from "./pipelineEvents.js";

/**
 * Map one tracer JSONL line (already a string) to a NodeEvent that
 * PipelineApp's emit() callback expects, or null when the line should be
 * skipped (pipeline-start/end markers, validation-failure, malformed JSON,
 * unknown kinds).
 *
 * Shared by replayTraceIntoApp (static replay) and pipeline-jsonl-tail
 * (live tail). One parser, two callers.
 */
export function mapTraceLineToEvent(line: string): NodeEvent | null {
  let trace: Record<string, unknown>;
  try {
    trace = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (trace.kind) {
    case "node-start": {
      const nodeId = String(trace.nodeId ?? "");
      const nodeReceiveId = trace.nodeReceiveId != null ? String(trace.nodeReceiveId) : undefined;
      const contextSnapshot = trace.contextSnapshot as Record<string, unknown> | undefined;
      const hasContext = contextSnapshot != null && Object.keys(contextSnapshot).length > 0;
      return {
        kind: "start",
        nodeId,
        label: nodeId,
        blockKind: "agent",
        nodeReceiveId,
        hasContext,
      };
    }
    case "node-end": {
      const success = Boolean(trace.success);
      const failureReason = trace.failureReason != null ? String(trace.failureReason) : undefined;
      return {
        kind: "end",
        outcome: {
          status: success ? "success" : "fail",
          reason: failureReason,
        },
      };
    }
    case "pipeline-start":
    case "pipeline-end":
    case "validation-failure":
      return null;
    default:
      return null;
  }
}

export function replayTraceIntoApp(
  tracePath: string,
  emit: (ev: NodeEvent) => void,
): void {
  if (!existsSync(tracePath)) return;
  let content: string;
  try {
    content = readFileSync(tracePath, "utf8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    if (!line) continue;
    const ev = mapTraceLineToEvent(line);
    if (ev) emit(ev);
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/replayTraceIntoApp.test.ts`
Expected: PASS — all 5 cases green.

- [x] **Step 5: Run the whole CLI suite to catch any caller that relied on the old shape**

Run: `npx vitest run src/cli/tests`
Expected: PASS. (Old callers only relied on the side-effect of `replayTraceIntoApp` calling `emit`, which is unchanged.)

- [x] **Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 7: Commit**

```bash
git add src/cli/lib/replayTraceIntoApp.ts src/cli/tests/replayTraceIntoApp.test.ts
git commit -m "refactor(replay): extract mapTraceLineToEvent for tail-adapter reuse"
```

### Task 1.2: Add `src/cli/lib/pipeline-jsonl-tail.ts`

**Files:**
- Create: `src/cli/lib/pipeline-jsonl-tail.ts`
- Test: `src/cli/tests/pipeline-jsonl-tail.test.ts`

Live-tail adapter for an in-progress `pipeline.jsonl`. Reads the file once on mount to seed history, then `fs.watch`es for appends. Each new line is parsed via `mapTraceLineToEvent` and emitted as a `NodeEvent`. When a `pipeline-end` event is observed, `onPipelineEnd` fires; consumer calls `handle.stop()`.

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/pipeline-jsonl-tail.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { tailPipelineJsonl } from "../lib/pipeline-jsonl-tail.js";
import type { NodeEvent } from "../lib/pipelineEvents.js";

function flush(ms = 50): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe("tailPipelineJsonl", () => {
  it("seeds emit() with events already on disk before watching", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tail-seed-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file,
      JSON.stringify({ kind: "node-start", nodeId: "a", contextSnapshot: {} }) + "\n" +
      JSON.stringify({ kind: "node-end",   success: true }) + "\n"
    );
    const events: NodeEvent[] = [];
    const handle = tailPipelineJsonl(file, (ev) => events.push(ev));
    await flush();
    handle.stop();
    expect(events.map(e => e.kind)).toEqual(["start", "end"]);
    rmSync(dir, { recursive: true });
  });

  it("emits new events when the file is appended after mount", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tail-append-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, JSON.stringify({ kind: "pipeline-start" }) + "\n");
    const events: NodeEvent[] = [];
    const handle = tailPipelineJsonl(file, (ev) => events.push(ev));
    await flush();
    appendFileSync(file,
      JSON.stringify({ kind: "node-start", nodeId: "b", contextSnapshot: { x: 1 } }) + "\n"
    );
    await flush(150);
    handle.stop();
    const starts = events.filter(e => e.kind === "start");
    expect(starts.length).toBe(1);
    expect((starts[0] as any).nodeId).toBe("b");
    rmSync(dir, { recursive: true });
  });

  it("fires onPipelineEnd when a pipeline-end line is appended", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tail-end-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, "");
    const onEnd = vi.fn();
    const handle = tailPipelineJsonl(file, () => {}, onEnd);
    await flush();
    appendFileSync(file, JSON.stringify({ kind: "pipeline-end", outcome: "success" }) + "\n");
    await flush(150);
    handle.stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
    rmSync(dir, { recursive: true });
  });

  it("survives a missing file (no throw, no events)", async () => {
    const handle = tailPipelineJsonl("/nonexistent/never-exists.jsonl", () => {});
    await flush();
    handle.stop();
  });

  it("ignores malformed lines and partial trailing fragments", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tail-malformed-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, "{not json\n" +
      JSON.stringify({ kind: "node-start", nodeId: "a", contextSnapshot: {} }) + "\n" +
      "{partial");  // no trailing newline → buffered
    const events: NodeEvent[] = [];
    const handle = tailPipelineJsonl(file, (ev) => events.push(ev));
    await flush();
    handle.stop();
    expect(events.map(e => e.kind)).toEqual(["start"]);
    rmSync(dir, { recursive: true });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline-jsonl-tail.test.ts`
Expected: FAIL — `Cannot find module '../lib/pipeline-jsonl-tail.js'`.

- [x] **Step 3: Implement the tail adapter**

Create `src/cli/lib/pipeline-jsonl-tail.ts`:

```ts
// src/cli/lib/pipeline-jsonl-tail.ts
import { existsSync, readFileSync, watch, type FSWatcher } from "fs";
import type { NodeEvent } from "./pipelineEvents.js";
import { mapTraceLineToEvent } from "./replayTraceIntoApp.js";

export interface TailHandle {
  stop(): void;
}

/**
 * Tail a pipeline.jsonl file. On mount, seeds with whatever is on disk.
 * Then watches for appends via fs.watch and emits one NodeEvent per
 * newline-terminated line. Buffered (incomplete) trailing fragments are
 * held until the next read completes them.
 *
 * onPipelineEnd fires the first time a {kind:"pipeline-end"} line appears.
 * The consumer is responsible for calling handle.stop().
 */
export function tailPipelineJsonl(
  tracePath: string,
  onEvent: (ev: NodeEvent) => void,
  onPipelineEnd?: () => void,
): TailHandle {
  let offset = 0;
  let pending = "";
  let endFired = false;
  let watcher: FSWatcher | null = null;

  function readNew(): void {
    if (!existsSync(tracePath)) return;
    let text: string;
    try { text = readFileSync(tracePath, "utf8"); }
    catch { return; }
    if (text.length < offset) {
      // Truncation — restart from scratch.
      offset = 0;
      pending = "";
    }
    if (text.length === offset) return;
    const chunk = pending + text.slice(offset);
    offset = text.length;
    const lines = chunk.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      // Check for pipeline-end signal before mapping (mapTraceLineToEvent
      // returns null for pipeline-end).
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.kind === "pipeline-end" && !endFired) {
          endFired = true;
          onPipelineEnd?.();
        }
      } catch { /* fall through to mapper which also returns null */ }
      const ev = mapTraceLineToEvent(line);
      if (ev) onEvent(ev);
    }
  }

  readNew();
  try {
    watcher = watch(tracePath, () => readNew());
  } catch {
    // File may not exist yet — caller should retry mount if it appears.
    watcher = null;
  }
  return {
    stop: () => {
      try { watcher?.close(); } catch { /* ignore */ }
      watcher = null;
    },
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/pipeline-jsonl-tail.test.ts`
Expected: PASS — all 5 cases green.

- [x] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 6: Commit**

```bash
git add src/cli/lib/pipeline-jsonl-tail.ts src/cli/tests/pipeline-jsonl-tail.test.ts
git commit -m "feat(tail): add pipeline-jsonl-tail.ts (fs.watch + line→event)"
```

### Task 1.3: Add `<PipelineRunView>` — live + interactive renderer

**Files:**
- Create: `src/cli/components/PipelineRunView.tsx`

Lifts the live + interactive half of `src/cli/components/PipelineApp.tsx`. Same prop shape, same `PipelineAppCallbacks` interface (renamed to `PipelineRunViewCallbacks`), same `renderPipelineApp` mount factory (renamed to `renderPipelineRunView`). Body is a near-verbatim copy of `PipelineApp.tsx` lines 1–317; no behavior change.

- [x] **Step 1: Write a smoke test for the run view**

Create `src/cli/tests/pipeline-run-view.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PipelineRunView } from "../components/PipelineRunView.js";

describe("PipelineRunView", () => {
  it("renders header with pipeline name, pid, and trace path", async () => {
    const { lastFrame, unmount } = render(
      <PipelineRunView
        pipelineName="demo"
        pid={1234}
        nodes={["start", "work", "done"]}
        runId="r1"
        tracePath="/tmp/r1/pipeline.jsonl"
        onReady={() => {}}
      />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("demo");
    expect(out).toContain("PID 1234");
    expect(out).toContain("/tmp/r1/pipeline.jsonl");
    unmount();
  });

  it("emits onReady with emit + done callbacks", async () => {
    let captured: { emit: Function; done: Function } | null = null;
    const { unmount } = render(
      <PipelineRunView
        pipelineName="demo"
        pid={1}
        nodes={[]}
        runId="r2"
        tracePath="/tmp/r2/pipeline.jsonl"
        onReady={(cbs) => { captured = cbs as any; }}
      />
    );
    await new Promise(r => setTimeout(r, 20));
    expect(captured).not.toBeNull();
    expect(typeof captured!.emit).toBe("function");
    expect(typeof captured!.done).toBe("function");
    unmount();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `FORCE_COLOR=0 npx vitest run src/cli/tests/pipeline-run-view.test.tsx`
Expected: FAIL — `Cannot find module '../components/PipelineRunView.js'`.

- [x] **Step 3: Create `src/cli/components/PipelineRunView.tsx`**

Copy the entire current contents of `src/cli/components/PipelineApp.tsx` (lines 1–317) into the new file with the following symbol renames:

| Old symbol | New symbol |
|---|---|
| `PipelineApp` | `PipelineRunView` |
| `PipelineAppCallbacks` | `PipelineRunViewCallbacks` |
| `renderPipelineApp` | `renderPipelineRunView` |

No other changes — same imports, same `StaticItem` union, same `useApp`/`useInput`/`<Static>`/`<LiveFooter>` structure, same `renderPipelineApp` factory body. The file is the live half; `PipelineApp.tsx` stays in place (deleted in Task 2.3).

Verbatim guidance:

- Imports identical (lines 1–11 of `PipelineApp.tsx`).
- Replace `export interface PipelineAppCallbacks` with `export interface PipelineRunViewCallbacks`.
- Replace `export function PipelineApp(` with `export function PipelineRunView(`.
- Replace `export async function renderPipelineApp(` with `export async function renderPipelineRunView(`.
- Inside `renderPipelineRunView`, `React.createElement(PipelineApp, …)` becomes `React.createElement(PipelineRunView, …)`.
- All other lines (the `StaticItem` union, `BlockCloseView`, the `useEffect`/`useReducer`/`useRef` machinery, the `<Static>` render block) are byte-identical.

- [x] **Step 4: Run test to verify it passes**

Run: `FORCE_COLOR=0 npx vitest run src/cli/tests/pipeline-run-view.test.tsx`
Expected: PASS — both cases green.

- [x] **Step 5: Type check + full CLI suite (no consumer migrated yet, so old PipelineApp tests still pass)**

Run: `npx tsc --noEmit && npx vitest run src/cli/tests`
Expected: clean + green (the new view is additive; nothing imports it yet).

- [x] **Step 6: Commit**

```bash
git add src/cli/components/PipelineRunView.tsx src/cli/tests/pipeline-run-view.test.tsx
git commit -m "feat(views): add PipelineRunView (lifted live half of PipelineApp)"
```

### Task 1.4: Add `<PipelineTraceView>` — read-only renderer

**Files:**
- Create: `src/cli/components/PipelineTraceView.tsx`

Read-only `StaticItem` renderer. Accepts `tracePath`, `runId`, `isLive`. When `isLive === false`, seeds via `replayTraceIntoApp`; when `isLive === true`, seeds + tails via `tailPipelineJsonl`. No `useInput`, no `useApp` exit handling, no `LiveFooter`. Parent owns process lifecycle.

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/pipeline-trace-view.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { render } from "ink-testing-library";
import { PipelineTraceView } from "../components/PipelineTraceView.js";

function flush(ms = 50): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

describe("PipelineTraceView", () => {
  it("renders block-open headers for each node-start in a finished trace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-static-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file,
      JSON.stringify({ kind: "node-start", nodeId: "alpha", contextSnapshot: {} }) + "\n" +
      JSON.stringify({ kind: "node-end",   success: true }) + "\n"
    );
    const { lastFrame, unmount } = render(
      <PipelineTraceView tracePath={file} runId="r1" isLive={false} />
    );
    await flush();
    const out = lastFrame() ?? "";
    expect(out).toContain("alpha");
    unmount();
    rmSync(dir, { recursive: true });
  });

  it("appends new headers when file grows in live mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-live-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, JSON.stringify({ kind: "pipeline-start" }) + "\n");
    const { lastFrame, unmount } = render(
      <PipelineTraceView tracePath={file} runId="r2" isLive={true} />
    );
    await flush();
    appendFileSync(file,
      JSON.stringify({ kind: "node-start", nodeId: "beta", contextSnapshot: {} }) + "\n"
    );
    await flush(150);
    expect(lastFrame() ?? "").toContain("beta");
    unmount();
    rmSync(dir, { recursive: true });
  });

  it("fires onPipelineEnd callback when pipeline-end appears (live mode)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-end-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, "");
    let ended = false;
    const { unmount } = render(
      <PipelineTraceView
        tracePath={file} runId="r3" isLive={true}
        onPipelineEnd={() => { ended = true; }}
      />
    );
    await flush();
    appendFileSync(file, JSON.stringify({ kind: "pipeline-end", outcome: "success" }) + "\n");
    await flush(150);
    expect(ended).toBe(true);
    unmount();
    rmSync(dir, { recursive: true });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `FORCE_COLOR=0 npx vitest run src/cli/tests/pipeline-trace-view.test.tsx`
Expected: FAIL — `Cannot find module '../components/PipelineTraceView.js'`.

- [x] **Step 3: Implement `src/cli/components/PipelineTraceView.tsx`**

```tsx
// src/cli/components/PipelineTraceView.tsx
import React, { useEffect, useState } from "react";
import { Box, Static, Text } from "ink";
import type { Block, BodyLine, NodeEvent } from "../lib/pipelineEvents.js";
import { BodyLineView } from "./BlockView.js";
import { StreamLine } from "./ui.js";
import type { StreamEvent } from "../lib/stream-formatter.js";
import { replayTraceIntoApp } from "../lib/replayTraceIntoApp.js";
import { tailPipelineJsonl, type TailHandle } from "../lib/pipeline-jsonl-tail.js";

type StaticItem =
  | { kind: "block-open";  id: string; nodeId: string; label: string }
  | { kind: "body-line";   id: string; line: BodyLine }
  | { kind: "stream-event"; id: string; event: StreamEvent }
  | { kind: "block-close"; id: string; block: Block };

interface Props {
  tracePath: string;
  runId: string;
  isLive: boolean;
  onPipelineEnd?: () => void;
}

const HEADER_WIDTH = 80;

export function PipelineTraceView({ tracePath, runId, isLive, onPipelineEnd }: Props) {
  const [items, setItems] = useState<StaticItem[]>([]);

  useEffect(() => {
    let seq = 0;
    let liveBlockId: string | null = null;
    let liveNodeId: string | null = null;

    const handleEvent = (ev: NodeEvent) => {
      if (ev.kind === "start") {
        seq++;
        const id = `${ev.nodeId}-${seq}`;
        liveBlockId = id;
        liveNodeId = ev.nodeId;
        setItems(prev => [
          ...prev,
          { kind: "block-open", id, nodeId: ev.nodeId, label: ev.label },
        ]);
      } else if (ev.kind === "end" && liveBlockId && liveNodeId) {
        const closedId = liveBlockId;
        const closedNodeId = liveNodeId;
        setItems(prev => [
          ...prev,
          {
            kind: "block-close",
            id: `${closedId}-close`,
            block: {
              id: closedId,
              nodeId: closedNodeId,
              label: closedId,
              kind: "agent",
              body: [],
              outcome: ev.outcome,
              stats: { turns: 0, tokensIn: 0, tokensOut: 0, durationMs: 0 },
            },
          },
        ]);
      }
    };

    if (isLive) {
      const handle: TailHandle = tailPipelineJsonl(tracePath, handleEvent, () => {
        onPipelineEnd?.();
      });
      return () => handle.stop();
    } else {
      replayTraceIntoApp(tracePath, handleEvent);
    }
  }, [tracePath, isLive]);

  return (
    <Static items={items}>
      {(item) => {
        if (item.kind === "block-open") {
          const prefix = `━━ ${item.nodeId} · ${item.label} `;
          const pad = Math.max(0, HEADER_WIDTH - prefix.length);
          return <Text key={item.id}>{prefix + "━".repeat(pad)}</Text>;
        }
        if (item.kind === "body-line") return <BodyLineView key={item.id} line={item.line} />;
        if (item.kind === "stream-event") return <StreamLine key={item.id} event={item.event} />;
        if (item.kind === "block-close") {
          const glyph = item.block.outcome.status === "success" ? "✓" : "✗";
          return (
            <Box key={item.id} flexDirection="column" marginBottom={1}>
              <Text dimColor>{`  ${glyph} ${item.block.outcome.status}${item.block.outcome.reason ? ` · ${item.block.outcome.reason}` : ""}`}</Text>
            </Box>
          );
        }
        return null;
      }}
    </Static>
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `FORCE_COLOR=0 npx vitest run src/cli/tests/pipeline-trace-view.test.tsx`
Expected: PASS — all 3 cases green.

- [x] **Step 5: Type check + full suite**

Run: `npx tsc --noEmit && npx vitest run src/cli/tests`
Expected: clean + green.

- [x] **Step 6: Commit**

```bash
git add src/cli/components/PipelineTraceView.tsx src/cli/tests/pipeline-trace-view.test.tsx
git commit -m "feat(views): add PipelineTraceView (read-only StaticItem renderer + live tail)"
```

## Verification targets

- Smokes: `None` (no pipelines/smoke/*.dot exists in this repo; smoke surface is at `src/cli/tests/smoke/implement-pipeline-smoke.dot` and is unaffected here)
- Manual exercises: `None` (chunk is additive — nothing user-visible yet)
- Lint: `npx tsc --noEmit`; `npx vitest run src/cli/tests/replayTraceIntoApp.test.ts src/cli/tests/pipeline-jsonl-tail.test.ts src/cli/tests/pipeline-run-view.test.tsx src/cli/tests/pipeline-trace-view.test.tsx`
- Surfaces touched: Ink components, lib (replay + tail), tests

---

## Chunk 2: Migrate consumers — delete `PipelineApp`, `WatchApp`, `apparat watch`

**Intent:** Switch every consumer of `PipelineApp` to `PipelineRunView`. Delete `PipelineApp.tsx`, `WatchApp.tsx`, `commands/watch.ts`. Drop the `program.command("watch")` registration. Rewrite the `heartbeat watch` shim so its `renderWatch` no longer calls the deleted `renderWatchApp`, and update its test. `apparat pipeline list` survives this chunk (deletion is in Chunk 4); `apparat status` still has its current (old) implementation.

### Task 2.1: Migrate `src/cli/commands/pipeline/run.ts` to `renderPipelineRunView`

**Files:**
- Modify: `src/cli/commands/pipeline/run.ts:26` (import) + any call site of `renderPipelineApp`

- [x] **Step 1: Locate the import + call**

Current `src/cli/commands/pipeline/run.ts:26` reads:
```ts
import { renderPipelineApp } from "../../components/PipelineApp.js";
```

Grep for the call site:
```bash
grep -n "renderPipelineApp" src/cli/commands/pipeline/run.ts
```
Expected: one import line + one call site.

- [x] **Step 2: Update the import + call**

Edit `src/cli/commands/pipeline/run.ts`:
- Change import line to:
  ```ts
  import { renderPipelineRunView } from "../../components/PipelineRunView.js";
  ```
- Replace the single `renderPipelineApp(` call with `renderPipelineRunView(`.

No other changes — the props shape and return shape are identical between the two.

- [x] **Step 3: Run the pipeline run command's tests**

Run: `npx vitest run src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-headless.test.ts`
Expected: tests pass that don't depend on the unchanged-yet `PipelineApp.test.tsx`. If any test in these files mounts `renderPipelineApp` indirectly, it gets `renderPipelineRunView` now — behavior is identical.

- [x] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/pipeline/run.ts
git commit -m "refactor(run): switch from renderPipelineApp to renderPipelineRunView"
```

### Task 2.2: Migrate test files that mount `PipelineApp` directly

**Files:**
- Modify: `src/cli/tests/pipeline-app-integration.test.tsx`
- Modify: `src/cli/tests/pipeline-headless.test.ts`
- Modify: `src/cli/tests/LiveFooter.test.tsx` (only if it imports `PipelineApp`; verify)

- [x] **Step 1: Inspect each file for `PipelineApp` imports + usages**

```bash
grep -nE "PipelineApp|renderPipelineApp" \
  src/cli/tests/pipeline-app-integration.test.tsx \
  src/cli/tests/pipeline-headless.test.ts \
  src/cli/tests/LiveFooter.test.tsx
```

- [x] **Step 2: For each occurrence, rename in place**

In each file:
- `import { PipelineApp, … } from "../components/PipelineApp.js"` → `import { PipelineRunView, … } from "../components/PipelineRunView.js"`.
- `import { renderPipelineApp, … }` → `import { renderPipelineRunView, … }`.
- `<PipelineApp …/>` → `<PipelineRunView …/>`.
- `renderPipelineApp(` → `renderPipelineRunView(`.
- Type imports: `PipelineAppCallbacks` → `PipelineRunViewCallbacks`.

No assertion changes — behavior is identical.

- [x] **Step 3: Run the migrated tests**

Run: `FORCE_COLOR=0 npx vitest run src/cli/tests/pipeline-app-integration.test.tsx src/cli/tests/pipeline-headless.test.ts src/cli/tests/LiveFooter.test.tsx`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/cli/tests/pipeline-app-integration.test.tsx src/cli/tests/pipeline-headless.test.ts src/cli/tests/LiveFooter.test.tsx
git commit -m "test: migrate PipelineApp mounts to PipelineRunView"
```

### Task 2.3: Delete `PipelineApp.tsx` + `PipelineApp.test.tsx`

**Files:**
- Delete: `src/cli/components/PipelineApp.tsx`
- Delete: `src/cli/tests/PipelineApp.test.tsx`

- [x] **Step 1: Verify no remaining importers**

```bash
grep -rnE "from .*PipelineApp(\\.js)?\"|from .*PipelineApp(\\.js)?'" src
```
Expected: zero matches. If any, fix them first (re-run Task 2.2 for the offender) before deleting.

- [x] **Step 2: Delete the files**

```bash
git rm src/cli/components/PipelineApp.tsx src/cli/tests/PipelineApp.test.tsx
```

- [x] **Step 3: Run full CLI suite + tsc**

Run: `npx tsc --noEmit && npx vitest run src/cli/tests`
Expected: clean + green.

- [x] **Step 4: Commit**

```bash
git commit -m "chore: delete PipelineApp.tsx + its test (split into Run/Trace views)"
```

### Task 2.4: Delete `WatchApp.tsx`, `watch-composition.test.tsx`, `commands/watch.ts`; rewire `heartbeat watch` shim

**Files:**
- Delete: `src/cli/components/WatchApp.tsx`
- Delete: `src/cli/tests/watch-composition.test.tsx`
- Delete: `src/cli/commands/watch.ts`
- Modify: `src/cli/components/HeartbeatWatch.tsx:89-93` (drop the `renderWatchApp` import + delegation)
- Modify: `src/cli/tests/watch.test.ts` (rewrite to assert new shim behavior — see Step 4)

The `heartbeat watch` shim today says "deprecated; use `apparat watch` instead" and forwards to `renderWatchApp`. After this task, `apparat watch` no longer exists. The shim is rewritten to print a one-line deprecation pointer to `apparat status` and exit 0 — no Ink rendering.

- [x] **Step 1: Rewrite `HeartbeatWatch.tsx` `renderWatch` (lines ~89-93)**

Edit the `renderWatch` export in `src/cli/components/HeartbeatWatch.tsx`. Replace:
```ts
import { renderWatchApp } from "./WatchApp.js";

export async function renderWatch(): Promise<void> {
  process.stderr.write("[apparat] `heartbeat watch` is deprecated; use `apparat watch` instead.\n");
  await renderWatchApp();
}
```
with:
```ts
export async function renderWatch(): Promise<void> {
  process.stderr.write("[apparat] `heartbeat watch` is deprecated; use `apparat status` instead.\n");
}
```

Drop the `import { renderWatchApp }` line entirely.

- [x] **Step 2: Delete the source files**

```bash
git rm src/cli/components/WatchApp.tsx src/cli/tests/watch-composition.test.tsx src/cli/commands/watch.ts
```

- [x] **Step 3: Drop `program.command("watch")` and its import in `src/cli/program.ts`**

Edit `src/cli/program.ts`:
- Remove line 13: `import { watchCommand } from "./commands/watch.js";`
- Remove the entire `program.command("watch") …` block at lines 245-250.
- In the existing help text block at line 84, remove the line `  apparat watch                             Live cross-project dashboard`.
- In the help text block at line 41, remove `(deprecated alias for 'apparat watch')` — leave the rest of the `heartbeat watch` example line in place with description `(deprecated — see apparat status)`.

Concretely the line at 41 becomes:
```
  apparat heartbeat watch                                 (deprecated — see apparat status)
```

- [x] **Step 4: Rewrite `src/cli/tests/watch.test.ts`**

Replace the entire contents of `src/cli/tests/watch.test.ts` with:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderWatch } from "../components/HeartbeatWatch.js";

describe("`heartbeat watch` deprecation shim", () => {
  it("prints a deprecation notice pointing at `apparat status` and returns without rendering", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await renderWatch();
    const out = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("`heartbeat watch` is deprecated");
    expect(out).toContain("apparat status");
    stderrSpy.mockRestore();
  });
});
```

- [x] **Step 5: Run watch test + full suite + tsc**

Run:
```bash
npx vitest run src/cli/tests/watch.test.ts && \
  npx tsc --noEmit && \
  npx vitest run src/cli/tests
```
Expected: PASS — the new watch.test passes; `apparat watch` references are gone; no other test broke.

- [x] **Step 6: Sanity grep**

```bash
grep -rnE "from .*WatchApp(\\.js)?\"|from .*WatchApp(\\.js)?'" src
grep -rnE "from .*commands/watch(\\.js)?\"|from .*commands/watch(\\.js)?'" src
grep -nE "program\\.command\\(\"watch\"" src/cli/program.ts
```
Expected: all three return zero matches.

- [x] **Step 7: Commit**

```bash
git add src/cli/components/HeartbeatWatch.tsx src/cli/program.ts src/cli/tests/watch.test.ts
git commit -m "chore: delete apparat watch verb, WatchApp, heartbeat watch shim no longer forwards"
```

## Verification targets

- Smokes: `None`
- Manual exercises: `apparat watch` → Commander error "unknown command"; `apparat heartbeat watch` → stderr message containing `apparat status`; `apparat pipeline run <smoke.dot>` (e.g. `src/cli/tests/smoke/implement-pipeline-smoke.dot`) — same TUI behavior as before, now mounted via `PipelineRunView`
- Lint: `npx tsc --noEmit`; `npx vitest run src/cli/tests`
- Surfaces touched: CLI commands (delete `watch`), Ink components (delete `PipelineApp`, `WatchApp`), heartbeat shim, tests

---

## Chunk 3: Mission-control state + render modules

**Intent:** Build the `MissionZoom`/`MissionState` discriminated union, the `getMissionControlState(zoom)` projector, and the four pure formatters under `mission-control-render.ts`. Nothing wires this to the `status` command yet — that is Chunk 4. The new modules ship behind tests only.

### Task 3.1: Export `summarize` from `runs-index.ts` as `summarizeRun`

**Files:**
- Modify: `src/cli/lib/runs-index.ts:48-74`

The mission-control state for the `run` level needs to summarize a single run by id. The existing `summarize(runId, runDir)` helper is module-private; expose it as `summarizeRun(runsRoot, runId)` so callers don't need to know the directory join.

- [x] **Step 1: Write a failing test**

Append to `src/cli/tests/runs-index.test.ts` (create if missing) — but first check whether one exists:

```bash
ls src/cli/tests/runs-index*.test.ts 2>/dev/null
```

If the file doesn't exist, create `src/cli/tests/runs-index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { summarizeRun, listAllRuns } from "../lib/runs-index.js";

describe("summarizeRun", () => {
  it("returns a RunSummary for an existing run dir with a finished trace", () => {
    const root = mkdtempSync(join(tmpdir(), "runs-summary-"));
    const dir = join(root, "r-1");
    mkdirSync(dir);
    writeFileSync(join(dir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n" +
      JSON.stringify({ kind: "pipeline-end",   outcome: "success",   timestamp: "2026-05-11T10:00:01Z" }) + "\n"
    );
    const s = summarizeRun(root, "r-1");
    expect(s.runId).toBe("r-1");
    expect(s.pipelineName).toBe("demo");
    expect(s.outcome).toBe("success");
    rmSync(root, { recursive: true });
  });

  it("returns outcome 'crashed' when the run dir has no pipeline.jsonl", () => {
    const root = mkdtempSync(join(tmpdir(), "runs-summary-"));
    const dir = join(root, "r-2");
    mkdirSync(dir);
    const s = summarizeRun(root, "r-2");
    expect(s.outcome).toBe("crashed");
    expect(s.runId).toBe("r-2");
    rmSync(root, { recursive: true });
  });

  it("returns outcome 'in-progress' when pipeline-end is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "runs-summary-"));
    const dir = join(root, "r-3");
    mkdirSync(dir);
    writeFileSync(join(dir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n"
    );
    expect(summarizeRun(root, "r-3").outcome).toBe("in-progress");
    rmSync(root, { recursive: true });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/runs-index.test.ts`
Expected: FAIL — `summarizeRun is not a function`.

- [x] **Step 3: Export `summarizeRun` from `runs-index.ts`**

Edit `src/cli/lib/runs-index.ts`. After the existing private `summarize` function (line 74), add:

```ts
export function summarizeRun(runsRoot: string, runId: string): RunSummary {
  return summarize(runId, join(runsRoot, runId));
}
```

Do not rename the private `summarize` — keep the existing call sites in `listAllRuns` working.

- [x] **Step 4: Run test to verify it passes + full suite**

Run: `npx vitest run src/cli/tests/runs-index.test.ts && npx vitest run src/cli/tests`
Expected: PASS.

- [x] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 6: Commit**

```bash
git add src/cli/lib/runs-index.ts src/cli/tests/runs-index.test.ts
git commit -m "feat(runs-index): export summarizeRun(runsRoot, runId)"
```

### Task 3.2: Add `mission-control.ts` types + `level: "all"` projection

**Files:**
- Create: `src/cli/lib/mission-control.ts`
- Create: `src/cli/tests/mission-control.test.ts`

- [x] **Step 1: Write the failing test for `level: "all"`**

Create `src/cli/tests/mission-control.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { withFakeApparatHome, type FakeApparatHome } from "./_apparatHome.js";
import { getMissionControlState } from "../lib/mission-control.js";

vi.mock("../../lib/daemon-client.js", () => ({
  request: vi.fn().mockResolvedValue({ type: "tasks", data: [] }),
}));

let scratch: FakeApparatHome;

beforeEach(() => {
  scratch = withFakeApparatHome("mission-control-home");
});
afterEach(() => {
  scratch.cleanup();
});

function registerProject(absPath: string, lastSeen = Date.now()): void {
  const projectsFile = join(scratch.path, "projects.json");
  let list: Array<{ path: string; lastSeen: number }> = [];
  if (existsSync(projectsFile)) {
    list = JSON.parse(readFileSync(projectsFile, "utf8"));
  }
  list.push({ path: absPath, lastSeen });
  writeFileSync(projectsFile, JSON.stringify(list, null, 2) + "\n");
}

describe("getMissionControlState — level: all", () => {
  it("returns empty projects + empty runningNow when no projects registered", async () => {
    const s = await getMissionControlState({ level: "all" });
    expect(s.level).toBe("all");
    if (s.level !== "all") throw new Error("type guard");
    expect(s.projects).toEqual([]);
    expect(s.runningNow).toEqual([]);
    expect(s.zoomHint).toBe("");
  });

  it("includes a running-now entry when a project has an in-progress run", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-"));
    const runsRoot = join(projDir, ".apparat", "runs");
    mkdirSync(join(runsRoot, "run-x"), { recursive: true });
    writeFileSync(join(runsRoot, "run-x", "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n"
    );
    registerProject(projDir);

    const s = await getMissionControlState({ level: "all" });
    if (s.level !== "all") throw new Error("type guard");
    expect(s.runningNow.length).toBe(1);
    expect(s.runningNow[0].runId).toBe("run-x");
    expect(s.zoomHint).toContain(projDir);
    rmSync(projDir, { recursive: true });
  });

  it("returns tasks = 'daemon-offline' when the daemon RPC fails", async () => {
    const { request } = await import("../../lib/daemon-client.js");
    (request as any).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const s = await getMissionControlState({ level: "all" });
    if (s.level !== "all") throw new Error("type guard");
    expect(s.tasks).toBe("daemon-offline");
  });
});
```

> **Helper note for the executing session:** `withFakeApparatHome` is the existing test fixture at `src/cli/tests/_apparatHome.ts`. The returned object exposes `{ path, cleanup }` — `path` (not `dir`) is the temp APPARAT_HOME directory. The import path in the test snippet above is correct.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/mission-control.test.ts`
Expected: FAIL — `Cannot find module '../lib/mission-control.js'`.

- [x] **Step 3: Create `src/cli/lib/mission-control.ts` with the `all` projection**

```ts
// src/cli/lib/mission-control.ts
import { readProjects, type ProjectEntry } from "./projects-registry.js";
import {
  listAllRuns, listRunsForPipeline, summarizeRun,
  type RunSummary,
} from "./runs-index.js";
import { readLastRunOutcome, type LastRunOutcome } from "./pipeline-status.js";
import { listAllPipelines, type PipelineEntry } from "./pipeline-resolver.js";
import { runsDir } from "./apparat-paths.js";
import { request } from "../../lib/daemon-client.js";
import type { Task } from "../../daemon/state.js";
import { existsSync } from "fs";
import { join } from "path";

const DAEMON_TIMEOUT_MS = 1500;

interface ListTasksResponse { type: "tasks"; data: Task[] }

async function listTasksWithTimeout(): Promise<Task[] | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), DAEMON_TIMEOUT_MS);
    request("list_tasks")
      .then((res) => {
        clearTimeout(timer);
        const r = res as ListTasksResponse;
        resolve(r?.data ?? []);
      })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

export type MissionZoom =
  | { level: "all" }
  | { level: "project";  projectPath: string }
  | { level: "pipeline"; projectPath: string; pipelineName: string }
  | { level: "run";      projectPath: string; pipelineName: string; runId: string };

export interface MissionRunningNow {
  projectPath: string;
  pipelineName: string;
  runId: string;
  startedAt: string | null;
}

export interface MissionStateAll {
  level: "all";
  projects: ProjectEntry[];
  runningNow: MissionRunningNow[];
  lastRunPerProject: Record<string, LastRunOutcome | null>;
  tasks: Task[] | "daemon-offline";
  zoomHint: string;
}

export interface MissionStateProject {
  level: "project";
  project: ProjectEntry;
  pipelines: PipelineEntry[];
  recentRuns: RunSummary[];
  tasks: Task[] | "daemon-offline";
  zoomHint: string;
}

export interface MissionStatePipeline {
  level: "pipeline";
  project: ProjectEntry;
  pipeline: PipelineEntry;
  runs: RunSummary[];
  liveRun: RunSummary | null;
  zoomHint: string;
}

export interface MissionStateRun {
  level: "run";
  project: ProjectEntry;
  pipeline: PipelineEntry | null;            // resolved by name when available
  run: RunSummary;
  tracePath: string;
  isLive: boolean;
  zoomHint: "";
}

export type MissionState =
  | MissionStateAll
  | MissionStateProject
  | MissionStatePipeline
  | MissionStateRun
  | { level: "error"; message: string };

export async function getMissionControlState(zoom: MissionZoom): Promise<MissionState> {
  switch (zoom.level) {
    case "all":      return projectAll();
    case "project":  return Promise.reject(new Error("not implemented in this step"));
    case "pipeline": return Promise.reject(new Error("not implemented in this step"));
    case "run":      return Promise.reject(new Error("not implemented in this step"));
  }
}

async function projectAll(): Promise<MissionStateAll> {
  const projects = readProjects();
  const tasksPromise = listTasksWithTimeout();
  const runningNow: MissionRunningNow[] = [];
  const lastRunPerProject: Record<string, LastRunOutcome | null> = {};

  for (const p of projects) {
    const root = runsDir(p.path);
    for (const r of listAllRuns(root)) {
      if (r.outcome === "in-progress") {
        runningNow.push({
          projectPath: p.path,
          pipelineName: r.pipelineName ?? "(unknown)",
          runId: r.runId,
          startedAt: r.startedAt,
        });
      }
    }
    lastRunPerProject[p.path] = readLastRunOutcome(root);
  }

  const tasksRaw = await tasksPromise;
  const tasks: Task[] | "daemon-offline" = tasksRaw === null ? "daemon-offline" : tasksRaw;
  const firstProject = [...projects].sort((a, b) => b.lastSeen - a.lastSeen)[0];
  const zoomHint = firstProject ? `apparat status ${firstProject.path}` : "";

  return { level: "all", projects, runningNow, lastRunPerProject, tasks, zoomHint };
}
```

- [x] **Step 4: Run test to verify it passes + tsc**

Run: `npx vitest run src/cli/tests/mission-control.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/mission-control.ts src/cli/tests/mission-control.test.ts
git commit -m "feat(mission-control): add MissionZoom/MissionState + level:all projection"
```

> **Implementer note (2026-05-11):** Shipped at commit `830b2e6`. All 3 new tests pass; `tsc --noEmit` clean. The forward-declared imports (`listRunsForPipeline`, `summarizeRun`, `listAllPipelines`, `existsSync`, `join`) needed by Tasks 3.3–3.5 are retained and silenced with `void`; tsconfig has no `noUnusedLocals` so they compile cleanly.

### Task 3.3: Implement `level: "project"` projection

**Files:**
- Modify: `src/cli/lib/mission-control.ts`
- Modify: `src/cli/tests/mission-control.test.ts`

- [x] **Step 1: Add failing tests**

Append to `mission-control.test.ts`:

```ts
describe("getMissionControlState — level: project", () => {
  it("returns project + pipelines roster + recent runs when project is registered", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-one-"));
    mkdirSync(join(projDir, ".apparat", "pipelines"), { recursive: true });
    writeFileSync(join(projDir, ".apparat", "pipelines", "demo.dot"),
      `digraph g { goal="x" start [shape=Mdiamond] done [shape=Msquare] start -> done }`);
    registerProject(projDir);

    const s = await getMissionControlState({ level: "project", projectPath: projDir });
    if (s.level !== "project") throw new Error("type guard");
    expect(s.project.path).toBe(projDir);
    expect(s.pipelines.some(p => p.name === "demo")).toBe(true);
    expect(s.zoomHint).toContain(projDir);
    rmSync(projDir, { recursive: true });
  });

  it("returns level: 'error' when projectPath is not registered", async () => {
    const s = await getMissionControlState({ level: "project", projectPath: "/no/such/path" });
    expect(s.level).toBe("error");
    if (s.level !== "error") throw new Error("type guard");
    expect(s.message).toContain("project not registered");
  });
});
```

- [x] **Step 2: Run test to verify both new cases fail**

Run: `npx vitest run src/cli/tests/mission-control.test.ts`
Expected: FAIL on the two new cases ("not implemented in this step").

- [x] **Step 3: Replace the `case "project":` branch + add `projectOne`**

In `src/cli/lib/mission-control.ts`, replace the `case "project":` line with `case "project":  return projectOne(zoom.projectPath, projects);`. Refactor `getMissionControlState` to fetch `projects` once and pass into branch helpers, OR move `readProjects()` into each branch (chosen — simpler diff).

Replace the `switch` body with:
```ts
  switch (zoom.level) {
    case "all":      return projectAll();
    case "project":  return projectOne(zoom.projectPath);
    case "pipeline": return Promise.reject(new Error("not implemented in this step"));
    case "run":      return Promise.reject(new Error("not implemented in this step"));
  }
```

Add the helper:

```ts
async function projectOne(projectPath: string): Promise<MissionState> {
  const projects = readProjects();
  const project = projects.find(p => p.path === projectPath);
  if (!project) {
    return { level: "error", message: `project not registered: ${projectPath} (apparat status to see roster)` };
  }
  const pipelines = listAllPipelines(project.path);
  const recentRuns = listAllRuns(runsDir(project.path));
  const tasksRaw = await listTasksWithTimeout();
  const tasks: Task[] | "daemon-offline" = tasksRaw === null
    ? "daemon-offline"
    : tasksRaw.filter(t => t.args.includes(project.path));
  const firstPipeline = pipelines[0];
  const zoomHint = firstPipeline
    ? `apparat status ${project.path} ${firstPipeline.name}`
    : `apparat status ${project.path}`;
  return {
    level: "project",
    project,
    pipelines,
    recentRuns,
    tasks,
    zoomHint,
  };
}
```

- [x] **Step 4: Run tests + tsc**

Run: `npx vitest run src/cli/tests/mission-control.test.ts && npx tsc --noEmit`
Expected: all 5 cases PASS, tsc clean.

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/mission-control.ts src/cli/tests/mission-control.test.ts
git commit -m "feat(mission-control): add level:project projection (with error case)"
```

> **Implementer note (2026-05-11):** Shipped at commit `cbd74bb`. All 5 mission-control tests pass; `tsc --noEmit` clean. Spec-compliance + code-quality reviewers both approved without changes. The remaining `void listRunsForPipeline; void summarizeRun; void existsSync; void join;` references in `mission-control.ts` are still reserved for Tasks 3.4/3.5.

### Task 3.4: Implement `level: "pipeline"` projection [x]

**Files:**
- Modify: `src/cli/lib/mission-control.ts`
- Modify: `src/cli/tests/mission-control.test.ts`

- [x] **Step 1: Add failing tests**

Append to `mission-control.test.ts`:

```ts
describe("getMissionControlState — level: pipeline", () => {
  it("returns runs filtered to the named pipeline", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-pipe-"));
    mkdirSync(join(projDir, ".apparat", "pipelines"), { recursive: true });
    writeFileSync(join(projDir, ".apparat", "pipelines", "demo.dot"),
      `digraph g { goal="x" start [shape=Mdiamond] done [shape=Msquare] start -> done }`);
    mkdirSync(join(projDir, ".apparat", "runs", "r-a"), { recursive: true });
    writeFileSync(join(projDir, ".apparat", "runs", "r-a", "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n" +
      JSON.stringify({ kind: "pipeline-end",   outcome: "success", timestamp: "2026-05-11T10:00:01Z" }) + "\n"
    );
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "pipeline", projectPath: projDir, pipelineName: "demo",
    });
    if (s.level !== "pipeline") throw new Error("type guard");
    expect(s.runs.length).toBe(1);
    expect(s.runs[0].runId).toBe("r-a");
    expect(s.zoomHint).toContain("r-a");
    rmSync(projDir, { recursive: true });
  });

  it("returns level: 'error' when pipeline name not in roster", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-pipe-"));
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "pipeline", projectPath: projDir, pipelineName: "does-not-exist",
    });
    expect(s.level).toBe("error");
    if (s.level !== "error") throw new Error("type guard");
    expect(s.message).toContain("pipeline not found");
    rmSync(projDir, { recursive: true });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/mission-control.test.ts`
Expected: FAIL.

- [x] **Step 3: Add `projectPipeline` helper, wire branch**

In `mission-control.ts`:
- Switch case: `case "pipeline": return projectPipeline(zoom.projectPath, zoom.pipelineName);`
- Helper:

```ts
async function projectPipeline(
  projectPath: string,
  pipelineName: string,
): Promise<MissionState> {
  const projects = readProjects();
  const project = projects.find(p => p.path === projectPath);
  if (!project) {
    return { level: "error", message: `project not registered: ${projectPath} (apparat status to see roster)` };
  }
  const pipelines = listAllPipelines(project.path);
  const pipeline = pipelines.find(e => e.name === pipelineName);
  if (!pipeline) {
    return {
      level: "error",
      message: `pipeline not found: ${pipelineName} (apparat status ${projectPath} to see roster)`,
    };
  }
  const runs = listRunsForPipeline(runsDir(project.path), pipelineName);
  const liveRun = runs.find(r => r.outcome === "in-progress") ?? null;
  const newestRunId = runs[0]?.runId;
  const zoomHint = newestRunId
    ? `apparat status ${project.path} ${pipelineName} ${newestRunId}`
    : `apparat status ${project.path} ${pipelineName}`;
  return { level: "pipeline", project, pipeline, runs, liveRun, zoomHint };
}
```

- [x] **Step 4: Run tests + tsc**

Run: `npx vitest run src/cli/tests/mission-control.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/mission-control.ts src/cli/tests/mission-control.test.ts
git commit -m "feat(mission-control): add level:pipeline projection"
```

### Task 3.5: Implement `level: "run"` projection

**Files:**
- Modify: `src/cli/lib/mission-control.ts`
- Modify: `src/cli/tests/mission-control.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `mission-control.test.ts`:

```ts
describe("getMissionControlState — level: run", () => {
  it("returns isLive=false + tracePath for a finished run", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-run-"));
    const runDir = join(projDir, ".apparat", "runs", "r-fin");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n" +
      JSON.stringify({ kind: "pipeline-end",   outcome: "success", timestamp: "2026-05-11T10:00:01Z" }) + "\n"
    );
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "run", projectPath: projDir, pipelineName: "demo", runId: "r-fin",
    });
    if (s.level !== "run") throw new Error("type guard");
    expect(s.isLive).toBe(false);
    expect(s.tracePath).toBe(join(runDir, "pipeline.jsonl"));
    expect(s.zoomHint).toBe("");
    rmSync(projDir, { recursive: true });
  });

  it("returns isLive=true for an in-progress run", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-run-live-"));
    const runDir = join(projDir, ".apparat", "runs", "r-live");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n"
    );
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "run", projectPath: projDir, pipelineName: "demo", runId: "r-live",
    });
    if (s.level !== "run") throw new Error("type guard");
    expect(s.isLive).toBe(true);
    rmSync(projDir, { recursive: true });
  });

  it("returns level: 'error' when runId not found", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-run-missing-"));
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "run", projectPath: projDir, pipelineName: "demo", runId: "nope",
    });
    expect(s.level).toBe("error");
    if (s.level !== "error") throw new Error("type guard");
    expect(s.message).toContain("run not found");
    rmSync(projDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/mission-control.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `projectRun` helper, wire branch**

In `mission-control.ts`:
- Switch case: `case "run": return projectRun(zoom.projectPath, zoom.pipelineName, zoom.runId);`
- Helper:

```ts
async function projectRun(
  projectPath: string,
  pipelineName: string,
  runId: string,
): Promise<MissionState> {
  const projects = readProjects();
  const project = projects.find(p => p.path === projectPath);
  if (!project) {
    return { level: "error", message: `project not registered: ${projectPath} (apparat status to see roster)` };
  }
  const root = runsDir(project.path);
  if (!existsSync(join(root, runId))) {
    return {
      level: "error",
      message: `run not found: ${runId} (apparat status ${projectPath} ${pipelineName} to see runs)`,
    };
  }
  const run = summarizeRun(root, runId);
  const tracePath = join(root, runId, "pipeline.jsonl");
  const pipeline = listAllPipelines(project.path).find(e => e.name === pipelineName) ?? null;
  return {
    level: "run",
    project,
    pipeline,
    run,
    tracePath,
    isLive: run.outcome === "in-progress",
    zoomHint: "",
  };
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/cli/tests/mission-control.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/mission-control.ts src/cli/tests/mission-control.test.ts
git commit -m "feat(mission-control): add level:run projection with isLive + error case"
```

### Task 3.6: Add `mission-control-render.ts` formatters

**Files:**
- Create: `src/cli/lib/mission-control-render.ts`
- Modify: `src/cli/tests/mission-control.test.ts` (add formatter tests)

Pure formatters — no IO. Each takes a `MissionState…` and an `output` writer (the existing `src/cli/lib/output.ts` module). The leaf `renderRun` is special: it does NOT print text, it mounts `<PipelineTraceView>` and awaits a pipeline-end signal for live runs. We isolate the Ink mount inside `renderRun` so the static-output cases stay testable as plain string assertions.

- [ ] **Step 1: Add failing tests**

Append to `mission-control.test.ts`:

```ts
import * as output from "../lib/output.js";
import {
  renderAll, renderProject, renderPipeline, renderRun,
} from "../lib/mission-control-render.js";

describe("mission-control-render — renderAll", () => {
  it("prints 'No projects registered yet.' when projects empty", async () => {
    const infoSpy = vi.spyOn(output, "info").mockResolvedValue();
    await renderAll({
      level: "all", projects: [], runningNow: [], lastRunPerProject: {},
      tasks: [], zoomHint: "",
    });
    const all = infoSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(all).toContain("No projects registered yet.");
    expect(all).not.toContain("running now:");
    expect(all).not.toContain("zoom in:");
    infoSpy.mockRestore();
  });

  it("prints a running-now block + zoom-in line when both present", async () => {
    const infoSpy = vi.spyOn(output, "info").mockResolvedValue();
    await renderAll({
      level: "all",
      projects: [{ path: "/p", lastSeen: 0 }],
      runningNow: [{ projectPath: "/p", pipelineName: "demo", runId: "r-1", startedAt: "2026-05-11T10:00:00Z" }],
      lastRunPerProject: { "/p": null },
      tasks: [],
      zoomHint: "apparat status /p",
    });
    const all = infoSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(all).toContain("running now:");
    expect(all).toContain("/p");
    expect(all).toContain("demo");
    expect(all).toContain("r-1");
    expect(all).toContain("zoom in: apparat status /p");
    infoSpy.mockRestore();
  });
});

describe("mission-control-render — zoom-hint byte shape", () => {
  it("renderProject ends with literal 'zoom in: apparat status <projectPath> <pipelineName>'", async () => {
    const infoSpy = vi.spyOn(output, "info").mockResolvedValue();
    await renderProject({
      level: "project",
      project: { path: "/p", lastSeen: 0 },
      pipelines: [{ name: "demo", origin: "local-flat", absPath: "/p/.apparat/pipelines/demo.dot" }],
      recentRuns: [],
      tasks: [],
      zoomHint: "apparat status /p demo",
    });
    const last = String(infoSpy.mock.calls[infoSpy.mock.calls.length - 1][0]);
    expect(last).toBe("zoom in: apparat status /p demo");
    infoSpy.mockRestore();
  });

  it("renderPipeline emits zoom hint with runId when runs present", async () => {
    const infoSpy = vi.spyOn(output, "info").mockResolvedValue();
    await renderPipeline({
      level: "pipeline",
      project: { path: "/p", lastSeen: 0 },
      pipeline: { name: "demo", origin: "local-flat", absPath: "/x.dot" },
      runs: [{
        runId: "r-1", pipelineName: "demo", startedAt: "2026-05-11T10:00:00Z",
        outcome: "success", durationMs: 1200, failedNodeId: null,
      }],
      liveRun: null,
      zoomHint: "apparat status /p demo r-1",
    });
    const last = String(infoSpy.mock.calls[infoSpy.mock.calls.length - 1][0]);
    expect(last).toBe("zoom in: apparat status /p demo r-1");
    infoSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify failures**

Run: `npx vitest run src/cli/tests/mission-control.test.ts`
Expected: FAIL — `Cannot find module '../lib/mission-control-render.js'`.

- [ ] **Step 3: Implement `src/cli/lib/mission-control-render.ts`**

```ts
// src/cli/lib/mission-control-render.ts
import * as output from "./output.js";
import type {
  MissionStateAll, MissionStateProject, MissionStatePipeline, MissionStateRun,
} from "./mission-control.js";
import type { RunSummary } from "./runs-index.js";

function glyph(o: RunSummary["outcome"]): string {
  return o === "success" ? "✓" : o === "failure" ? "✗" : o === "in-progress" ? "…" : "·";
}

async function emitZoomHint(hint: string): Promise<void> {
  if (hint) await output.info(`zoom in: ${hint}`);
}

export async function renderAll(s: MissionStateAll): Promise<void> {
  if (s.projects.length === 0) {
    await output.info("No projects registered yet. Run `apparat pipeline run …` in a project to register it.");
    return;
  }
  await output.info(`Apparat status — ${s.projects.length} project(s)\n`);
  if (s.runningNow.length > 0) {
    await output.info("running now:");
    for (const r of s.runningNow) {
      await output.info(`  ${r.projectPath}  ${r.pipelineName}  ${r.runId}${r.startedAt ? `  started ${r.startedAt}` : ""}`);
    }
    await output.info("");
  }
  for (const p of [...s.projects].sort((a, b) => b.lastSeen - a.lastSeen)) {
    await output.info(`  ${p.path}`);
    await output.info(`    last seen: ${new Date(p.lastSeen).toLocaleString()}`);
    if (s.tasks === "daemon-offline") {
      await output.info(`    heartbeat tasks: (daemon offline)`);
    } else {
      const projTasks = s.tasks.filter(t => t.args.includes(p.path));
      await output.info(`    heartbeat tasks: ${projTasks.length === 0 ? "(none)" : projTasks.map(t => t.id).join(", ")}`);
    }
    const last = s.lastRunPerProject[p.path];
    if (last) {
      await output.info(`    last run: ${last.runId} — ${last.outcome} at ${last.timestamp}`);
    } else {
      await output.info(`    last run: (no runs yet)`);
    }
    await output.info("");
  }
  await emitZoomHint(s.zoomHint);
}

export async function renderProject(s: MissionStateProject): Promise<void> {
  await output.info(`${s.project.path} — pipelines\n`);
  if (s.pipelines.length === 0) {
    await output.info("  (no pipelines)");
  } else {
    for (const e of s.pipelines) await output.info(`  ${e.name}`);
  }
  await output.info("");
  await output.info("recent runs:");
  if (s.recentRuns.length === 0) {
    await output.info("  (none)");
  } else {
    for (const r of s.recentRuns) {
      const ts = r.startedAt ?? "(unknown start)";
      const dur = r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—";
      await output.info(`  ${glyph(r.outcome)}  ${r.runId}  ${r.pipelineName ?? "(unknown)"}  ${ts}  ${dur}`);
    }
  }
  await output.info("");
  await emitZoomHint(s.zoomHint);
}

export async function renderPipeline(s: MissionStatePipeline): Promise<void> {
  await output.info(`${s.project.path} / ${s.pipeline.name}\n`);
  await output.info("recent runs:");
  if (s.runs.length === 0) {
    await output.info("  (none)");
  } else {
    for (const r of s.runs) {
      const ts = r.startedAt ?? "(unknown start)";
      const dur = r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—";
      const tail = r.outcome === "failure" && r.failedNodeId ? `   failed at: ${r.failedNodeId}` : "";
      await output.info(`  ${glyph(r.outcome)}  ${r.runId}  ${ts}  ${dur}${tail}`);
    }
  }
  await output.info("");
  await emitZoomHint(s.zoomHint);
}

export async function renderRun(s: MissionStateRun): Promise<void> {
  // Ink-rendered leaf — wired in Chunk 4 (Task 4.1). For now, print the
  // resolved trace path so consumers of the state module can fall back to a
  // string display if invoked before the chunk-4 wire-up.
  await output.info(`${s.project.path} / ${s.run.pipelineName ?? "(unknown)"} / ${s.run.runId}`);
  await output.info(s.tracePath);
}
```

> **Note for executing session:** `renderRun` ships with a placeholder body here; Chunk 4 Task 4.1 will replace it with the Ink `<PipelineTraceView>` mount that supports auto-tail and pipeline-end exit. Tests in this chunk only assert the string output of `renderAll`, `renderProject`, `renderPipeline`.

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/cli/tests/mission-control.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/mission-control-render.ts src/cli/tests/mission-control.test.ts
git commit -m "feat(mission-control-render): add 4 zoom-level formatters (renderRun placeholder)"
```

## Verification targets

- Smokes: `None`
- Manual exercises: `None` (not wired to user-facing command yet — chunk 4 does that)
- Lint: `npx tsc --noEmit`; `npx vitest run src/cli/tests/mission-control.test.ts src/cli/tests/runs-index.test.ts`
- Surfaces touched: lib (new `mission-control.ts` + `mission-control-render.ts`), `runs-index.ts` (export `summarizeRun`), tests

---

## Chunk 4: Status rewrite + delete `pipeline list` + docs

**Intent:** Wire `mission-control` into the `apparat status` command. Register the positional chain `status [project] [pipeline] [runId]`. Replace `renderRun`'s placeholder with an actual `<PipelineTraceView>` mount that terminates on `pipeline-end`. Delete `apparat pipeline list` (verb + registration + module + tests). Migrate the in-place test cases that asserted the old `pipelineListCommand` to new `statusCommand` cases. Rewrite the README under one **Mission control** subsection. Grep CONTEXT.md for stale verb references. Add supersession headers to prior cluster specs.

### Task 4.1: Replace `renderRun` placeholder with `<PipelineTraceView>` mount

**Files:**
- Modify: `src/cli/lib/mission-control-render.ts` (`renderRun`)
- Optional helper: `src/cli/lib/render-trace-view.ts` (new, if extraction needed to keep `mission-control-render.ts` pure)

The challenge: `renderAll`/`renderProject`/`renderPipeline` are pure string emitters via `output.info`. `renderRun` must mount Ink — different surface. Extract the Ink mount into a tiny helper so `mission-control-render.ts` remains importable from non-Ink contexts (e.g. headless tests).

- [ ] **Step 1: Write a failing test for `renderRun`'s static path**

Append to `src/cli/tests/mission-control.test.ts`:

```ts
import { mkdtempSync as mkt2, mkdirSync as mkd2, writeFileSync as wf2, rmSync as rm2 } from "fs";
import { join as j2 } from "path";
import { tmpdir as t2 } from "os";

describe("renderRun — finished trace", () => {
  it("mounts PipelineTraceView and resolves after replay completes", async () => {
    const projDir = mkt2(j2(t2(), "mc-render-run-"));
    const runDir = j2(projDir, ".apparat", "runs", "r-z");
    mkd2(runDir, { recursive: true });
    wf2(j2(runDir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n" +
      JSON.stringify({ kind: "node-start", nodeId: "a", contextSnapshot: {} }) + "\n" +
      JSON.stringify({ kind: "node-end",   success: true }) + "\n" +
      JSON.stringify({ kind: "pipeline-end", outcome: "success", timestamp: "2026-05-11T10:00:01Z" }) + "\n"
    );
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "run", projectPath: projDir, pipelineName: "demo", runId: "r-z",
    });
    if (s.level !== "run") throw new Error("type guard");
    await renderRun(s);  // must resolve without hanging on a finished run
    rm2(projDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails or hangs**

Run: `npx vitest run src/cli/tests/mission-control.test.ts -t "renderRun"`
Expected: FAIL or hang (the placeholder prints `tracePath` only; no Ink mount). The implementing session can confirm whichever it sees.

- [ ] **Step 3: Add `src/cli/lib/render-trace-view.ts`**

```ts
// src/cli/lib/render-trace-view.ts
import React from "react";
import { render as inkRender } from "ink";
import { PipelineTraceView } from "../components/PipelineTraceView.js";

/**
 * Mount <PipelineTraceView> with the given trace path. If isLive, the
 * promise resolves the moment the tail observes a pipeline-end event.
 * Otherwise, mounts in static mode and resolves once the static frame
 * has been committed.
 */
export async function renderTraceView(args: {
  tracePath: string;
  runId: string;
  isLive: boolean;
}): Promise<void> {
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });

  const instance = inkRender(
    React.createElement(PipelineTraceView, {
      tracePath: args.tracePath,
      runId: args.runId,
      isLive: args.isLive,
      onPipelineEnd: () => resolve(),
    }),
    { patchConsole: false, exitOnCtrlC: true },
  );

  if (!args.isLive) {
    // Static replay — give Ink one tick to commit, then exit.
    await new Promise(r => setTimeout(r, 10));
    resolve();
  }
  await done;
  instance.unmount();
}
```

- [ ] **Step 4: Replace `renderRun` body in `mission-control-render.ts`**

```ts
import { renderTraceView } from "./render-trace-view.js";

export async function renderRun(s: MissionStateRun): Promise<void> {
  await output.info(`${s.project.path} / ${s.run.pipelineName ?? "(unknown)"} / ${s.run.runId}\n`);
  await renderTraceView({
    tracePath: s.tracePath,
    runId: s.run.runId,
    isLive: s.isLive,
  });
}
```

- [ ] **Step 5: Run the new test + full suite + tsc**

Run: `FORCE_COLOR=0 npx vitest run src/cli/tests/mission-control.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli/lib/render-trace-view.ts src/cli/lib/mission-control-render.ts src/cli/tests/mission-control.test.ts
git commit -m "feat(mission-control): renderRun mounts PipelineTraceView, exits on pipeline-end"
```

### Task 4.2: Rewrite `src/cli/commands/status.ts` to delegate to mission-control

**Files:**
- Modify: `src/cli/commands/status.ts` (full rewrite)

- [ ] **Step 1: Write failing tests for the new `statusCommand`**

Create `src/cli/tests/status-command.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { withFakeApparatHome, type FakeApparatHome } from "./fake-apparat-home.js";
import * as output from "../lib/output.js";
import { statusCommand } from "../commands/status.js";

vi.mock("../../lib/daemon-client.js", () => ({
  request: vi.fn().mockResolvedValue({ type: "tasks", data: [] }),
}));

let scratch: FakeApparatHome;

beforeEach(() => {
  scratch = withFakeApparatHome("status-cmd-home");
  vi.spyOn(output, "info").mockResolvedValue();
});
afterEach(() => {
  (output.info as any).mockRestore();
  scratch.cleanup();
});

function registerProject(absPath: string): void {
  const projectsFile = join(scratch.dir, "projects.json");
  let list: Array<{ path: string; lastSeen: number }> = [];
  try { list = JSON.parse(require("fs").readFileSync(projectsFile, "utf8")); } catch {}
  list.push({ path: absPath, lastSeen: Date.now() });
  writeFileSync(projectsFile, JSON.stringify(list, null, 2) + "\n");
}

describe("statusCommand (no args)", () => {
  it("prints the 'No projects registered yet.' message when registry empty", async () => {
    await statusCommand({});
    const all = (output.info as any).mock.calls.map((c: any) => String(c[0])).join("\n");
    expect(all).toContain("No projects registered yet.");
  });

  it("prints a 'zoom in:' hint line when one project is registered", async () => {
    const p = mkdtempSync(join(tmpdir(), "status-cmd-"));
    registerProject(p);
    await statusCommand({});
    const all = (output.info as any).mock.calls.map((c: any) => String(c[0])).join("\n");
    expect(all).toContain(`zoom in: apparat status ${p}`);
    rmSync(p, { recursive: true });
  });
});

describe("statusCommand (project arg)", () => {
  it("writes a clear error to stderr and exits 1 for unknown project", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__${code}`);
    }) as any);
    await expect(statusCommand({ project: "/nonexistent/dir" })).rejects.toThrow("__exit__1");
    const err = stderrSpy.mock.calls.map(c => String(c[0])).join("");
    expect(err).toContain("project not registered");
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/status-command.test.ts`
Expected: FAIL — current `statusCommand()` takes no args and doesn't handle positional zoom or error-exit.

- [ ] **Step 3: Replace `src/cli/commands/status.ts` body**

```ts
// src/cli/commands/status.ts
import { resolve } from "path";
import {
  getMissionControlState,
  type MissionZoom,
  type MissionState,
} from "../lib/mission-control.js";
import {
  renderAll, renderProject, renderPipeline, renderRun,
} from "../lib/mission-control-render.js";

export interface StatusArgs {
  project?: string;
  pipeline?: string;
  runId?: string;
}

export async function statusCommand(args: StatusArgs = {}): Promise<void> {
  const zoom = toZoom(args);
  const state = await getMissionControlState(zoom);
  if (state.level === "error") {
    process.stderr.write(state.message + "\n");
    process.exit(1);
  }
  switch (state.level) {
    case "all":      await renderAll(state); break;
    case "project":  await renderProject(state); break;
    case "pipeline": await renderPipeline(state); break;
    case "run":      await renderRun(state); break;
  }
}

function toZoom(args: StatusArgs): MissionZoom {
  if (!args.project) return { level: "all" };
  const projectPath = resolve(args.project);
  if (!args.pipeline) return { level: "project", projectPath };
  if (!args.runId)    return { level: "pipeline", projectPath, pipelineName: args.pipeline };
  return { level: "run", projectPath, pipelineName: args.pipeline, runId: args.runId };
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/cli/tests/status-command.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/status.ts src/cli/tests/status-command.test.ts
git commit -m "refactor(status): delegate to mission-control with positional zoom"
```

### Task 4.3: Update `program.ts` — register positional `status`, drop `pipeline list`, rewrite help text

**Files:**
- Modify: `src/cli/program.ts`

- [ ] **Step 1: Write a failing test for the new help wording**

Append to `src/cli/tests/pipeline.test.ts` (or create `src/cli/tests/program-help.test.ts` if you prefer isolation):

```ts
import { describe, it, expect } from "vitest";
import { createProgram } from "../program.js";

describe("createProgram help text", () => {
  it("contains a Mission control subsection naming `apparat status [project]`", () => {
    const help = createProgram().helpInformation();
    expect(help).toContain("Mission control");
    expect(help).toMatch(/apparat status\s+\[project\]/);
  });

  it("does not mention `apparat watch` or `apparat pipeline list` anywhere", () => {
    const help = createProgram().helpInformation();
    expect(help).not.toContain("apparat watch");
    expect(help).not.toContain("pipeline list");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline.test.ts -t "createProgram help text"`
Expected: FAIL — current help mentions `apparat watch` and `pipeline list`.

- [ ] **Step 3: Edit `src/cli/program.ts`**

Concrete edits (apply each):

1. **Drop the `pipelineListCommand` import** (line 8):
   ```diff
   -import { pipelineListCommand } from "./commands/pipeline/list.js";
   ```

2. **Drop the `pipeline.command("list [name]") …` block at lines 173-189** entirely.

3. **Rewrite the `status` registration at lines 238-243** to:
   ```ts
   program
     .command("status [project] [pipeline] [runId]")
     .description("Mission control — in-progress runs at top; zoom by appending the next token shown")
     .addHelpText("after", `
   Examples:
     apparat status                                # all projects + running now
     apparat status /path/to/proj                  # one project: pipelines roster + recent runs
     apparat status /path/to/proj demo             # one pipeline: runs table
     apparat status /path/to/proj demo <runId>     # one run: trace (auto-tails if in-progress)
   `)
     .action(async (project: string | undefined, pipeline: string | undefined, runId: string | undefined) => {
       await statusCommand({ project, pipeline, runId });
     });
   ```

4. **Rewrite the top-of-program `addHelpText("after", …)` block** so that:
   - Line 41's `apparat heartbeat watch` example reads: `  apparat heartbeat watch                                 (deprecated — see apparat status)`.
   - Line 47's `apparat pipeline list --project my-app …` example is **deleted**.
   - Lines 82-84's `Cross-project status:` block is replaced by:
     ```
     Mission control (one verb, zoom by appending tokens):
       apparat status                                # all projects, running-now block at top
       apparat status <projectPath>                  # zoom into one project's pipelines + recent runs
       apparat status <projectPath> <pipelineName>   # zoom into one pipeline's runs table
       apparat status <projectPath> <pipelineName> <runId>   # zoom into one run's trace
                                                     # live tails if the run is in-progress
     ```

- [ ] **Step 4: Run help test + full suite + tsc**

Run: `npx vitest run src/cli/tests/pipeline.test.ts && npx tsc --noEmit`
Expected: help test PASS; full suite has failing cases left for tasks 4.4–4.5 — that's expected this step.

- [ ] **Step 5: Commit**

```bash
git add src/cli/program.ts src/cli/tests/pipeline.test.ts
git commit -m "feat(program): register status [project] [pipeline] [runId]; drop pipeline list registration"
```

### Task 4.4: Delete `commands/pipeline/list.ts` + its dedicated tests; migrate in-place test cases

**Files:**
- Delete: `src/cli/commands/pipeline/list.ts`
- Delete: `src/cli/tests/pipeline-list-layer2.test.ts`
- Delete: `src/cli/tests/pipeline-list-resolver-parity.test.ts`
- Modify: `src/cli/tests/pipeline.test.ts` (replace the `describe("pipelineListCommand", …)` block at lines 354–426)
- Modify: `src/cli/tests/pipeline-preflight.test.ts` (line ~119 — drop the `pipeline list` invocation)

- [ ] **Step 1: Delete the source module**

```bash
git rm src/cli/commands/pipeline/list.ts
```

- [ ] **Step 2: Delete the dedicated test files**

```bash
git rm src/cli/tests/pipeline-list-layer2.test.ts src/cli/tests/pipeline-list-resolver-parity.test.ts
```

- [ ] **Step 3: Replace `describe("pipelineListCommand", …)` in `pipeline.test.ts:354-426`**

In `src/cli/tests/pipeline.test.ts`, replace the entire block at lines 354–426 (the `describe("pipelineListCommand", …)` and its 5 `it(…)` cases) with:

```ts
describe("statusCommand zoom-level equivalents (was: pipelineListCommand)", () => {
  let dir: string;
  let scratch: FakeApparatHome;
  beforeEach(() => {
    vi.clearAllMocks();
    scratch = withFakeApparatHome("apparat-status-home");
    dir = mkdtempSync(join(tmpdir(), "apparat-status-test-"));
  });
  afterEach(() => {
    scratch.cleanup();
    rmSync(dir, { recursive: true });
  });

  it("never prints the broken 'apparat pipeline create' hint, even on a fresh project", async () => {
    // Register the project so statusCommand resolves it.
    require("fs").writeFileSync(
      join(scratch.dir, "projects.json"),
      JSON.stringify([{ path: dir, lastSeen: Date.now() }], null, 2) + "\n",
    );
    await statusCommand({ project: dir });
    const calls = (out.info as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]));
    expect(calls.join("\n")).not.toContain("apparat pipeline create");
  });

  it("lists local pipelines under the project header with their names", async () => {
    require("fs").writeFileSync(
      join(scratch.dir, "projects.json"),
      JSON.stringify([{ path: dir, lastSeen: Date.now() }], null, 2) + "\n",
    );
    mkdirSync(join(dir, ".apparat", "pipelines"), { recursive: true });
    writeFileSync(join(dir, ".apparat", "pipelines", "review.dot"),
      `digraph g {\n  goal="Run review"\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`);
    await statusCommand({ project: dir });
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining("review"));
  });

  it("renders the runs table at level pipeline (was: layer-2 pipeline list)", async () => {
    require("fs").writeFileSync(
      join(scratch.dir, "projects.json"),
      JSON.stringify([{ path: dir, lastSeen: Date.now() }], null, 2) + "\n",
    );
    mkdirSync(join(dir, ".apparat", "pipelines"), { recursive: true });
    writeFileSync(join(dir, ".apparat", "pipelines", "demo.dot"),
      `digraph g {\n  goal="x"\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`);
    mkdirSync(join(dir, ".apparat", "runs", "r-1"), { recursive: true });
    writeFileSync(join(dir, ".apparat", "runs", "r-1", "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n" +
      JSON.stringify({ kind: "pipeline-end", outcome: "success", timestamp: "2026-05-11T10:00:01Z" }) + "\n"
    );
    await statusCommand({ project: dir, pipeline: "demo" });
    const calls = (out.info as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]));
    expect(calls.join("\n")).toContain("recent runs:");
    expect(calls.join("\n")).toContain("r-1");
  });
});
```

(Adjust the file's existing imports — at the top of `pipeline.test.ts` — to add `statusCommand`:
```ts
import { statusCommand } from "../commands/status.js";
```
and drop any `pipelineListCommand` import.)

- [ ] **Step 4: Edit `src/cli/tests/pipeline-preflight.test.ts:119`**

The case at line ~109-138 spawns `apparat pipeline list --project <project>` to check the `requires:` annotation. With `pipeline list` deleted, the assertion shifts to `apparat status <project>` if that surface still shows pipeline `requires:` — but the new `renderProject` does NOT print `requires:` (only `name`). Therefore: delete this assertion entirely. The preflight check itself (`requires:`-annotated pipelines preflight-fail with missing variables) is asserted elsewhere in the same file via direct invocation of the runner. If after deletion the surrounding `describe` block has only one orphan case, remove the whole describe.

Concretely:
- Identify the `describe("…")` that owns line 119. Delete the case spawning `apparat pipeline list --project …`.
- If the file ends up with no cases, delete the file (`git rm src/cli/tests/pipeline-preflight.test.ts`) — but only after confirming preflight coverage exists in another test file. If unsure, leave the file with the deleted case as the only edit.

- [ ] **Step 5: Run full suite + tsc**

Run: `npx vitest run src/cli/tests && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Sanity grep**

```bash
grep -rnE "pipelineListCommand|pipeline list" src
```
Expected: zero matches in `src/`.

- [ ] **Step 7: Commit**

```bash
git add -A src/cli/commands/pipeline/list.ts src/cli/tests/pipeline.test.ts \
        src/cli/tests/pipeline-list-layer2.test.ts src/cli/tests/pipeline-list-resolver-parity.test.ts \
        src/cli/tests/pipeline-preflight.test.ts
git commit -m "chore: delete apparat pipeline list verb; migrate tests to status zoom levels"
```

### Task 4.5: README + CONTEXT.md + supersession headers

**Files:**
- Modify: `README.md` (lines ~97-114 — the command-section block)
- Modify: `CONTEXT.md` (grep for stale verb references; cosmetic if any)
- Modify: `docs/superpowers/specs/2026-05-07-pipeline-mission-control-fragmentation-design.md` (header)
- Modify: `docs/superpowers/specs/2026-05-08-pipeline-list-hides-half-the-roster-design.md` (header)

- [ ] **Step 1: Grep README.md for stale references**

```bash
grep -nE "apparat (watch|pipeline list)" README.md
```
Expected: matches at lines 97, 112, 114 (or thereabouts).

- [ ] **Step 2: Rewrite the relevant README block under "Mission control"**

Locate the existing command section in `README.md`. Insert a new subsection titled `Mission control` containing:

```markdown
### Mission control

One verb, zoom by appending the next token:

- `apparat status` — every project at a glance, with a **running now:** block at the top listing any pipeline runs in flight across all projects.
- `apparat status <projectPath>` — zoom into one project: pipelines roster + recent runs table.
- `apparat status <projectPath> <pipelineName>` — zoom into one pipeline: per-pipeline runs table.
- `apparat status <projectPath> <pipelineName> <runId>` — zoom into one run: trace renderer. Auto-tails live if the run is in-progress; static replay if finished.

Every non-leaf output ends with a `zoom in:` line containing the exact next command to copy-paste.
```

Delete any lines referring to `apparat watch` or `apparat pipeline list` in the surrounding command section.

- [ ] **Step 3: Grep CONTEXT.md and patch any stale references**

```bash
grep -nE "apparat (watch|pipeline list)" CONTEXT.md
```

For each hit, replace with `apparat status` (or the closest equivalent in context). If no hits, no edit.

- [ ] **Step 4: Add supersession header to the two prior specs**

Edit `docs/superpowers/specs/2026-05-07-pipeline-mission-control-fragmentation-design.md`. Add at the top, immediately after the `# …` title:

```markdown
> **Superseded** for the cross-verb surface by `docs/superpowers/specs/2026-05-11-mission-control-three-doors-one-room-design.md`. The cluster-deepening insight remains valid; the chosen surface (deepening `pipeline list` alone) was replaced by collapsing three verbs into one `apparat status [project] [pipeline] [runId]`.
```

Edit `docs/superpowers/specs/2026-05-08-pipeline-list-hides-half-the-roster-design.md`. Add the same supersession header (referencing the same 2026-05-11 doc).

- [ ] **Step 5: Manual smoke (operator-eyes check)**

```bash
node ./dist/cli/index.js --help 2>&1 | grep -E "Mission control|watch|pipeline list"
```
Expected: `Mission control` line present; `apparat watch` and `pipeline list` absent.

(Skip if `dist/` isn't built locally; the help test added in Task 4.3 already asserts the same invariant.)

- [ ] **Step 6: Commit**

```bash
git add README.md CONTEXT.md \
        docs/superpowers/specs/2026-05-07-pipeline-mission-control-fragmentation-design.md \
        docs/superpowers/specs/2026-05-08-pipeline-list-hides-half-the-roster-design.md
git commit -m "docs: rewrite mission control section, mark prior specs superseded"
```

## Verification targets

- Smokes: `None`
- Manual exercises:
  - `apparat status` (no args, on a system with at least one in-progress run) — `running now:` block at top, `zoom in: apparat status <path>` at bottom.
  - `apparat status <projectPath>` — pipelines roster + recent-runs table + `zoom in: apparat status <path> <pipeline>`.
  - `apparat status <projectPath> <pipelineName>` — runs table + `zoom in: apparat status <path> <pipeline> <runId>`.
  - `apparat status <projectPath> <pipelineName> <runId>` for a finished run — static replay via `<PipelineTraceView>`; process exits 0.
  - `apparat status <projectPath> <pipelineName> <runId>` for an in-progress run — live tail; exits on `pipeline-end`.
  - `apparat watch` and `apparat pipeline list` — Commander error "unknown command".
  - `apparat heartbeat watch` — stderr "deprecated — see `apparat status`".
- Lint: `npx tsc --noEmit`; `npx vitest run src/cli/tests`
- Surfaces touched: CLI commands (`status.ts`), program registration, lib (mission-control + render + render-trace-view), README, CONTEXT.md, two prior design specs, tests

---

## Open questions surfaced during planning

- **`fake-apparat-home.ts` helper shape:** The plan's Chunk 3 + Chunk 4 tests assume the helper exposes a `dir` field (the temp `APPARAT_HOME` path). If it doesn't, the executing session must inspect `src/cli/tests/fake-apparat-home.ts` at the start of Chunk 3 and adjust how the tests write `projects.json` (e.g. use `projectsFilePath()` from `projects-registry.ts` directly).
- **`renderTraceView` exit timing for static replay:** The `setTimeout(r, 10)` to give Ink one commit tick is a pragmatic choice. If flaky in CI, switch to awaiting `instance.waitUntilExit()` after a `setImmediate`-driven exit signal inside `<PipelineTraceView>` once the `<Static>` items list stops growing. Decide if/when test flake demands it.
- **`pipeline-preflight.test.ts` after the line-119 deletion:** If the surrounding `describe` block ends up empty, decide between deleting the file or leaving the empty block. Defer to the executing session's read of the file's other assertions.
