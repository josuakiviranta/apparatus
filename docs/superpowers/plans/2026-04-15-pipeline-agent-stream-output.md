---
status: implemented
---

# Pipeline Agent Stream Output Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw body-line rendering in pipeline agent nodes with `streamEvents()`-based output, giving the same `▶▶▶ MAIN AGENT`, `▶ SUBAGENT:`, `→ [tool]`, `◈ ctx:` markers as `ralph implement`.

**Architecture:** Tee the agent's stdout stream — one branch feeds `parseStreamJsonEvents + parseClaudeEvent` (stats/trace-path only), the other feeds `streamEvents()` (rendering). The `streamEvents()` output is forwarded to PipelineApp via a new `stream-line` NodeEvent kind, which PipelineApp renders using the existing `StreamLine` component. Interactive agent nodes are unaffected (they never call `onStdout`).

**Tech Stack:** TypeScript, Ink/React, Node.js `stream.PassThrough`, existing `streamEvents()` and `StreamLine` from `src/cli/lib/stream-formatter.ts` / `src/cli/components/ui.tsx`.

**Spec:** `docs/superpowers/specs/2026-04-15-pipeline-agent-stream-output-design.md`

---

## Chunk 1: Extend NodeEvent + reducer

**Files:**
- Modify: `src/cli/lib/pipelineEvents.ts`
- Modify: `src/cli/lib/pipelineReducer.ts`
- Test: `src/cli/tests/pipelineReducer.test.ts`

### Task 1: Add `stream-line` to NodeEvent union

- [ ] **Step 1: Write the failing test**

Add to `src/cli/tests/pipelineReducer.test.ts`:

```typescript
it("stream-line event is a no-op (does not mutate state)", () => {
  let s: PipelineState = pipelineReducer(initialPipelineState, {
    kind: "start", nodeId: "run", label: "agent", blockKind: "agent",
  });
  const before = s;
  s = pipelineReducer(s, { kind: "stream-line", event: { type: "main_agent_open" } });
  expect(s).toBe(before); // same reference — no mutation
});
```

- [ ] **Step 2: Run test — expect TypeScript compile error** (stream-line not in NodeEvent yet)

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/pipelineReducer.test.ts 2>&1 | tail -20
```

Expected: TypeScript error — `stream-line` not assignable to `NodeEvent`.

- [ ] **Step 3: Add `stream-line` to NodeEvent in `src/cli/lib/pipelineEvents.ts`**

At the top of the file, add this import:
```typescript
import type { StreamEvent } from "./stream-formatter.js";
```

Add to the `NodeEvent` union (after the `gate-ready` line, before `end`):
```typescript
  | { kind: "stream-line"; event: StreamEvent }
```

- [ ] **Step 4: Add no-op case to reducer in `src/cli/lib/pipelineReducer.ts`**

After the `gate-ready` case (line 80) and before `case "end"`:
```typescript
    case "stream-line":
      return state;
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/pipelineReducer.test.ts 2>&1 | tail -20
```

Expected: all tests pass (including new no-op test).

- [ ] **Step 6: Run full test suite — confirm no regressions**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/lib/pipelineEvents.ts src/cli/lib/pipelineReducer.ts src/cli/tests/pipelineReducer.test.ts && git commit -m "$(cat <<'EOF'
feat: add stream-line NodeEvent kind (no-op in reducer)

Extends the NodeEvent union with stream-line for forwarding
StreamEvent objects through the pipeline emit path.
Reducer treats it as a no-op — rendering handled by PipelineApp.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 2: Tee onStdout in pipeline.ts

**Files:**
- Modify: `src/cli/commands/pipeline.ts:229-233`

> **Context:** Current `onStdout` (lines 229–233) runs `parseStreamJsonEvents + parseClaudeEvent` and emits `text`, `tool_use`, `stats`, `trace-path` NodeEvents. We replace this to tee the stream: one branch emits `stats` + `trace-path` only (from the existing path), the other runs `streamEvents()` and emits `stream-line` events for rendering.

### Task 2: Replace `onStdout` with tee + dual-parser

- [ ] **Step 1: Add `PassThrough` static import to `src/cli/commands/pipeline.ts`**

At line 10 of `pipeline.ts` (after the existing `import { spawn, spawnSync } from "child_process";`), add:

```typescript
import { PassThrough } from "stream";
```

- [ ] **Step 2: Replace the `onStdout` handler**

In `src/cli/commands/pipeline.ts`, replace lines 229–233:

```typescript
      onStdout: async (stdout) => {
        for await (const raw of parseStreamJsonEvents(stdout)) {
          for (const nev of parseClaudeEvent(raw)) emit(nev);
        }
      },
```

With:

```typescript
      onStdout: async (stdout) => {
        const statsStream = new PassThrough();
        const renderStream = new PassThrough();
        stdout.pipe(statsStream);
        stdout.pipe(renderStream);
        await Promise.all([
          (async () => {
            for await (const raw of parseStreamJsonEvents(statsStream)) {
              for (const nev of parseClaudeEvent(raw)) {
                if (nev.kind === "stats" || nev.kind === "trace-path") emit(nev);
              }
            }
          })(),
          (async () => {
            for await (const ev of streamEvents(renderStream)) {
              emit({ kind: "stream-line", event: ev });
            }
          })(),
        ]);
      },
```

`streamEvents`, `parseStreamJsonEvents`, `parseClaudeEvent` are all already imported at the top of `pipeline.ts`. `PassThrough` was added in Step 1.

- [ ] **Step 3: Build to verify TypeScript**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Run tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/commands/pipeline.ts && git commit -m "$(cat <<'EOF'
feat: tee agent stdout — streamEvents for render, stats/trace-path retained

onStdout now splits the agent stream via PassThrough:
- stats stream: parseStreamJsonEvents → emit stats + trace-path only
- render stream: streamEvents → emit stream-line events for PipelineApp

text/tool_use NodeEvents no longer emitted from onStdout; rendering
now comes through stream-line events handled by PipelineApp.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: Render stream-line events in PipelineApp

**Files:**
- Modify: `src/cli/components/PipelineApp.tsx`

> **Context:** `StaticItem` union (lines 25–30) needs a new `stream-event` kind. The `emit()` wrapper (inside `onReady` effect, lines 99–135) needs to handle `stream-line` events. The `Static` render (lines 195–228) needs a `stream-event` branch. `StreamLine` is already exported from `ui.tsx` and `StreamEvent` is in `stream-formatter.ts` — both need importing.

### Task 3: Add stream-event to PipelineApp

- [ ] **Step 1: Write a failing unit test for the new static item kind**

There is no direct unit test for PipelineApp (it's Ink). The regression test is the full vitest suite + manual smoke run. Verify current tests still pass first:

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/pipeline.test.ts 2>&1 | tail -30
```

Expected: current pipeline tests pass.

- [ ] **Step 2: Add imports to PipelineApp.tsx**

At the top of `src/cli/components/PipelineApp.tsx`, add:

```typescript
import type { StreamEvent } from "../lib/stream-formatter.js";
import { StreamLine } from "./ui.js";
```

- [ ] **Step 3: Add `stream-event` to `StaticItem` union**

In `src/cli/components/PipelineApp.tsx`, extend the `StaticItem` type (currently lines 25–30):

```typescript
type StaticItem =
  | { kind: "header";       id: string; pipelineName: string; pid: number; goal?: string; nodes: string[] }
  | { kind: "block-open";   id: string; displayIndex: number; nodeId: string; label: string }
  | { kind: "trace-line";   id: string; tracePath: string }
  | { kind: "body-line";    id: string; line: BodyLine }
  | { kind: "stream-event"; id: string; event: StreamEvent }
  | { kind: "block-close";  id: string; block: Block };
```

- [ ] **Step 4: Handle `stream-line` in the `emit()` wrapper**

In `src/cli/components/PipelineApp.tsx`, inside the `onReady` `emit` function, after the `tool_use` branch (around line 133), add:

```typescript
        } else if (event.kind === "stream-line" && liveBlockIdRef.current) {
          const i = liveBodyCountRef.current++;
          setStaticItems(prev => [
            ...prev,
            { kind: "stream-event", id: `${liveBlockIdRef.current}-body-${i}`, event: event.event },
          ]);
        }
```

Make sure `dispatch(event)` is still called at the end of the `emit` wrapper (it already is at line 134 — do not remove it; the reducer no-ops on `stream-line`).

- [ ] **Step 5: Render `stream-event` items in the Static block**

In the `Static` render callback (around line 216), add after the `body-line` branch:

```tsx
          if (item.kind === "stream-event") {
            return <StreamLine key={item.id} event={item.event} />;
          }
```

- [ ] **Step 6: Build**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/components/PipelineApp.tsx && git commit -m "$(cat <<'EOF'
feat: render stream-line events in PipelineApp via StreamLine

Adds stream-event StaticItem kind to PipelineApp. When emit() receives
a stream-line event, appends a stream-event static item rendered by
the existing StreamLine component. Gives pipeline agent nodes the same
▶▶▶ MAIN AGENT / ▶ SUBAGENT: / → [tool] / ◈ ctx: markers as
ralph implement.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 4: Smoke verification via tmux harness

**No code changes — verification only.**

> **Prerequisite:** Read `docs/harness/tmux-drive.md` and source the helper block into your current shell before running any step below.

- [ ] **Step 1: Build**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build
```

- [ ] **Step 2: Run full test suite one final time**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run 2>&1 | tail -40
```

Expected: all tests pass.

- [ ] **Step 3: Launch poc-implement pipeline in a tmux window**

Source the harness helpers (copy the block from `docs/harness/tmux-drive.md`), then:

```bash
start_run "ralph pipeline run poc-implement --project ~/poc-test"
```

This creates a new tmux window (`ralph-drive-<id>`), launches the command, and sets `SESSION`, `WIN`, `RUN_DIR` globals.

- [ ] **Step 4: Wait for first agent node to open**

```bash
wait_for_string "▶▶▶ MAIN AGENT" 120000
```

Expected: returns 0 within 2 minutes. If it times out, the stream-line events are not being emitted — check Chunk 2 onStdout change.

- [ ] **Step 5: Capture and verify stream markers**

```bash
wait_stable 3000
capture
cat "$RUN_DIR/current.txt"
```

Expected to find in output (exact tokens depend on actual run, but structure must be present):
```
━━ [1] run · agent ━━━━━━━━━━━━━━━━
▶▶▶ MAIN AGENT
→ [read] ...
◈ ctx: ... tokens
```

If subagents are dispatched (CHUNK-4 parallel task), also verify:
```
▶ SUBAGENT: ...
  → [bash] ...
◀ SUBAGENT
```

- [ ] **Step 6: Wait for pipeline to complete**

```bash
wait_for_string "✓ success" 300000
wait_stable 5000
capture
cat "$RUN_DIR/current.txt"
```

Expected: all nodes show `✓ success` in block-close footer. Token counts should be non-zero (`tokensIn/tokensOut tok`).

- [ ] **Step 7: Cleanup**

```bash
cleanup_run clean
```

- [ ] **Step 8: Verify non-agent nodes unchanged (inspect capture)**

In `$RUN_DIR/current.txt` inspect any tool/parallel/store node sections. They should NOT show `▶▶▶ MAIN AGENT` markers — their body renders via BodyLineView, not StreamLine.

If the pipeline has no tool/parallel/store nodes, skip this step.

---

## Reference

Key files and line numbers:
- `src/cli/lib/pipelineEvents.ts` — NodeEvent union, BodyLine, Block types
- `src/cli/lib/pipelineReducer.ts:24` — switch over NodeEvent kinds
- `src/cli/commands/pipeline.ts:229` — onStdout handler being replaced
- `src/cli/components/PipelineApp.tsx:25` — StaticItem union
- `src/cli/components/PipelineApp.tsx:99` — emit() wrapper
- `src/cli/components/PipelineApp.tsx:194` — Static render callback
- `src/cli/lib/stream-formatter.ts:69` — streamEvents() signature
- `src/cli/components/ui.tsx:42` — StreamLine component
- `src/cli/tests/pipelineReducer.test.ts` — reducer tests to extend
