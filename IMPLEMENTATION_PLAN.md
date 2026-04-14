# Pipeline TUI Flicker Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate per-frame flicker in the pipeline TUI by moving body lines out of LiveFooter's dynamic render tree and into Ink's `<Static>` array, so they are printed once and never erased.

**Architecture:** Replace the derived `staticItems` array in `PipelineApp` (which was header + frozen BlockViews) with a grow-only state array that receives individual items — `block-open`, `body-line`, `block-close` — as events arrive. `LiveFooter` drops its `block.body.map(...)` render entirely and becomes a fixed-height status footer (header + trace + status + optional input, ≤ 5 lines). No changes to `pipelineReducer` or `pipelineEvents`.

**Tech Stack:** TypeScript, React (Ink), ink-testing-library (vitest), tsup

---

## Background: What Was Found in the Debugging Session

Evidence collected on 2026-04-14:

**Render log (`/tmp/lf-renders-real.txt`) — 4.8-second run, single body line:**
- 55 total LiveFooter renders
- 52 renders at `body=0` (pure ticker, 100 ms interval)
- 3 renders at `body=1` (event burst when output arrived)
- Rate: ~11.6 renders/second

**ANSI escape sequences (raw stdout, body=0 phase):**
```
[2K[1A[2K[1A[2K[1A[2K[G
```
= 4× erase-line + 3× cursor-up = Ink erasing 3 LiveFooter lines before each redraw

**Scaling:** for a typical 30-line Claude response, LiveFooter height = 33 lines. Ink erases 33 lines × ~12/sec = **~400 terminal line erasures per second** → visible scramble.

**implement contrast:** `StreamOutput` in `src/cli/components/ui.tsx` wraps all events in `<Static items={events}>`. Ink never erases previous lines. Zero cursor-up.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/cli/components/PipelineApp.tsx` | **Modify** | Replace derived staticItems with grow-only useState; add emit wrapper that appends items; update useEffect to append block-close; update Static renderer |
| `src/cli/components/LiveFooter.tsx` | **Modify** | Remove `block.body.map(...)` (line 58) and trace line (lines 53-57) |
| `src/cli/tests/PipelineApp.test.tsx` | **Modify** | Add test verifying body lines appear during streaming (not only after end); existing tests must still pass |

**Not changed:** `pipelineReducer.ts`, `pipelineEvents.ts`, `BlockView.tsx` (keep it — used by tests and may be referenced elsewhere).

---

## Chunk 1: Failing Tests First

### Task 1: Write the failing LiveFooter isolation test

**Files:**
- Modify: `src/cli/tests/PipelineApp.test.tsx`

Context: `LiveFooter` currently renders `block.body.map(...)`. After the fix it must NOT render body lines. Write this test first so it fails, confirming the current broken behaviour.

- [ ] **Step 1: Add the failing test to PipelineApp.test.tsx**

Open `src/cli/tests/PipelineApp.test.tsx`. Add this new `describe` block at the bottom (after the existing `describe("PipelineApp", ...)` block):

```typescript
import { LiveFooter } from "../components/LiveFooter.js";
import type { LiveBlock } from "../lib/pipelineEvents.js";

function makeLiveBlock(overrides: Partial<LiveBlock> = {}): LiveBlock {
  return {
    id: "work-0",
    nodeId: "work",
    label: "agent",
    kind: "agent",
    startedAt: Date.now() - 1000,
    body: [],
    stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
    ...overrides,
  };
}

describe("LiveFooter", () => {
  it("does not render body lines — body is handled by PipelineApp Static", () => {
    const block = makeLiveBlock({
      body: [
        { kind: "text", role: "claude", text: "streamed content" },
        { kind: "tool_use", name: "Read", summary: "reading file" },
      ],
    });
    const { lastFrame } = render(<LiveFooter block={block} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("streamed content");
    expect(frame).not.toContain("claude:");
    expect(frame).not.toContain("[tool_use: Read]");
    // But it must still show the header and status
    expect(frame).toContain("[1] work");
    expect(frame).toContain("streaming");
  });
});
```

- [ ] **Step 2: Run the test to confirm it FAILS**

```bash
cd /Users/josu/Documents/projects/ralph-cli
npx vitest run src/cli/tests/PipelineApp.test.tsx 2>&1 | tail -20
```

Expected output: FAIL on the LiveFooter test — it currently contains "streamed content".

### Task 2: Write the failing PipelineApp body-during-streaming test

**Files:**
- Modify: `src/cli/tests/PipelineApp.test.tsx`

Context: Body lines must appear in PipelineApp's output even BEFORE the block ends (during streaming). The existing test only checks after `end`. This new test checks mid-stream.

- [ ] **Step 1: Add mid-stream body visibility test inside the existing PipelineApp describe block**

Add after the "freezes a single node" test:

```typescript
it("body lines appear in PipelineApp output while node is still live (mid-stream)", async () => {
  const { instance, cbs } = mount();
  cbs.emit({ kind: "start", nodeId: "work", label: "agent", blockKind: "agent" });
  cbs.emit({ kind: "text", role: "claude", text: "mid-stream line" });
  // NOTE: no `end` event — block is still live
  await flush();
  const frame = instance.lastFrame() ?? "";
  expect(frame).toContain("mid-stream line");
  expect(frame).toContain("claude:");
});
```

- [ ] **Step 2: Run to confirm it PASSES (it already works — body is in LiveFooter)**

```bash
npx vitest run src/cli/tests/PipelineApp.test.tsx 2>&1 | tail -20
```

Expected: this specific test PASSES (LiveFooter currently renders it). This is the "green anchor" — it must still pass after the refactor.

---

## Chunk 2: Implement PipelineApp Changes

### Task 3: Rewrite staticItems management in PipelineApp

**Files:**
- Modify: `src/cli/components/PipelineApp.tsx`

Context: Replace the 4-line derived `staticItems` computation (lines 110-114) with a grow-only `useState` array. Add an emit wrapper that appends `block-open` and `body-line` items. Extend the frozen-block useEffect to append `block-close` items.

Study the current code carefully before editing:
- Lines 22-24: `StaticItem` type — needs new variants
- Lines 111-114: derived staticItems — becomes initial state
- Lines 54-62: `readyOnce` useEffect where `onReady` is called — emit wrapper goes here
- Lines 36-43: `doneDispatched` useEffect on `state.frozen` — extend this to also append block-close

- [ ] **Step 1: Update the StaticItem type and add BodyLine import**

Replace lines 1-7 and lines 22-24 in `PipelineApp.tsx`:

```typescript
import React, { useEffect, useReducer, useRef, useState } from "react";
import { render as inkRender, Box, Static, Text, useApp, useInput } from "ink";
import { pipelineReducer } from "../lib/pipelineReducer.js";
import { initialPipelineState, type NodeEvent, type Block, type BodyLine } from "../lib/pipelineEvents.js";
import { BlockView, BodyLineView } from "./BlockView.js";
import { LiveFooter, type LiveBlockWithInput } from "./LiveFooter.js";
import { parseSlashCommand } from "../lib/slash-commands.js";
```

Replace `type StaticItem = ...` (lines 22-24) with:

```typescript
const HEADER_WIDTH = 80;

type StaticItem =
  | { kind: "header";     id: string; pipelineName: string; pid: number; goal?: string; nodes: string[] }
  | { kind: "block-open"; id: string; displayIndex: number; nodeId: string; label: string }
  | { kind: "trace-line"; id: string; tracePath: string }
  | { kind: "body-line";  id: string; line: BodyLine }
  | { kind: "block-close"; id: string; block: Block };
```

- [ ] **Step 2: Replace staticItems state + add tracking refs**

Inside `PipelineApp` function body, replace:
```typescript
// Assemble static items: header is always item 0, followed by frozen blocks.
const staticItems: StaticItem[] = [
  { kind: "header", id: "__header__", pipelineName, pid, goal, nodes },
  ...state.frozen.map((b) => ({ kind: "block" as const, id: b.id, block: b })),
];
```

with:

```typescript
// Grow-only static items — append-only, never removed or mutated.
const [staticItems, setStaticItems] = useState<StaticItem[]>(() => [
  { kind: "header", id: "__header__", pipelineName, pid, goal, nodes },
]);

// Refs for constructing stable IDs in the emit wrapper (no stale closures).
const liveBlockIdRef  = useRef<string | null>(null);
const liveBodyCountRef = useRef(0);
const frozenCountRef  = useRef(0);

// Track which frozen blocks have had their block-close item appended.
const staticCloseSeen = useRef<Set<string>>(new Set());
```

- [ ] **Step 3: Extend the doneDispatched useEffect to also append block-close items**

Replace the existing `useEffect` on `state.frozen` (lines 36-43):

```typescript
useEffect(() => {
  const newCloseItems: StaticItem[] = [];
  for (const block of state.frozen) {
    if (!staticCloseSeen.current.has(block.id)) {
      staticCloseSeen.current.add(block.id);
      frozenCountRef.current = state.frozen.length;
      newCloseItems.push({ kind: "block-close", id: `${block.id}-close`, block });
    }
    if (block.onDone && !doneDispatched.current.has(block.id)) {
      doneDispatched.current.add(block.id);
      try { block.onDone(); } catch { /* swallow */ }
    }
  }
  if (newCloseItems.length > 0) {
    setStaticItems(prev => [...prev, ...newCloseItems]);
  }
}, [state.frozen]);
```

- [ ] **Step 4: Update the readyOnce useEffect to wrap emit with static-item appending**

Replace lines 54-62:

```typescript
const readyOnce = useRef(false);
useEffect(() => {
  if (readyOnce.current) return;
  readyOnce.current = true;
  onReady({
    emit: (event) => {
      // Append static items for content-producing events.
      if (event.kind === "start") {
        const id = `${event.nodeId}-${frozenCountRef.current}`;
        liveBlockIdRef.current = id;
        liveBodyCountRef.current = 0;
        const displayIndex = frozenCountRef.current + 1;
        setStaticItems(prev => [
          ...prev,
          { kind: "block-open", id, displayIndex, nodeId: event.nodeId, label: event.label },
        ]);
      } else if (event.kind === "trace-path" && liveBlockIdRef.current) {
        const tracePath = `${process.env.HOME ?? "~"}/.claude/projects/${event.sessionId}.jsonl`;
        setStaticItems(prev => [
          ...prev,
          { kind: "trace-line", id: `${liveBlockIdRef.current}-trace`, tracePath },
        ]);
      } else if (event.kind === "text" && liveBlockIdRef.current) {
        const i = liveBodyCountRef.current++;
        setStaticItems(prev => [
          ...prev,
          { kind: "body-line", id: `${liveBlockIdRef.current}-body-${i}`,
            line: { kind: "text", role: event.role, text: event.text } },
        ]);
      } else if (event.kind === "tool_use" && liveBlockIdRef.current) {
        const i = liveBodyCountRef.current++;
        setStaticItems(prev => [
          ...prev,
          { kind: "body-line", id: `${liveBlockIdRef.current}-body-${i}`,
            line: { kind: "tool_use", name: event.name, summary: event.summary } },
        ]);
      }
      dispatch(event);
    },
    done: () => exit(),
  });
}, []);
```

> **Note on trace-path:** The inline path construction (`${process.env.HOME}/.claude/projects/${event.sessionId}.jsonl`) is a simplified version. Look at `src/cli/lib/claudeTracePath.ts` for the actual formula, import that function and use it instead if it's exported. If not exported, add `export` to its function declaration. The import in PipelineApp would be `import { claudeTracePath } from "../lib/claudeTracePath.js"`.

- [ ] **Step 5: Update the Static renderer in the JSX**

Replace the `<Static items={staticItems}>` block (lines 118-134):

```tsx
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
    if (item.kind === "block-open") {
      const prefix = `━━ [${item.displayIndex}] ${item.nodeId} · ${item.label} `;
      const pad = Math.max(0, HEADER_WIDTH - prefix.length);
      return <Text key={item.id}>{prefix + "━".repeat(pad)}</Text>;
    }
    if (item.kind === "trace-line") {
      return <Text key={item.id} dimColor>{`  trace: ${item.tracePath}`}</Text>;
    }
    if (item.kind === "body-line") {
      return <BodyLineView key={item.id} line={item.line} />;
    }
    if (item.kind === "block-close") {
      return (
        <Box key={item.id} flexDirection="column" marginBottom={1}>
          <BlockCloseView block={item.block} />
        </Box>
      );
    }
    return null;
  }}
</Static>
```

Add `BlockCloseView` as a local component just above `PipelineApp`:

```typescript
function BlockCloseView({ block }: { block: Block }) {
  const glyph = block.outcome.status === "success" ? "✓" : "✗";
  const parts = [`  ${glyph} ${block.outcome.status}`];
  if (block.outcome.reason) parts.push(block.outcome.reason);
  parts.push(`${block.stats.turns} turns`);
  parts.push(`${block.stats.tokensIn}/${block.stats.tokensOut} tok`);
  parts.push((block.stats.durationMs / 1000).toFixed(1) + "s");
  return <Text dimColor>{parts.join(" · ")}</Text>;
}
```

- [ ] **Step 6: Update the `index` prop passed to LiveFooter**

Replace:
```tsx
<LiveFooter block={liveForRender} index={state.frozen.length + 1} />
```
with:
```tsx
<LiveFooter block={liveForRender} index={frozenCountRef.current + 1} />
```

- [ ] **Step 7: Build and check for TypeScript errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: `⚡️ Build success`. Fix any type errors before proceeding.

- [ ] **Step 8: Run tests**

```bash
npx vitest run src/cli/tests/PipelineApp.test.tsx 2>&1
```

Expected: the new "mid-stream body visibility" test still PASSES. The LiveFooter test still FAILS (body still in LiveFooter — that's Task 4).

- [ ] **Step 9: Commit**

```bash
git add src/cli/components/PipelineApp.tsx
git commit -m "fix: grow-only static items in PipelineApp — body lines leave LiveFooter's dynamic tree"
```

---

## Chunk 3: Remove Body Lines from LiveFooter

### Task 4: Strip body rendering from LiveFooter

**Files:**
- Modify: `src/cli/components/LiveFooter.tsx`

Context: After Task 3, body lines are printed via Static in PipelineApp. LiveFooter must no longer render them. Also remove the trace line rendering (it moved to a `trace-line` static item appended by the emit wrapper in Task 3).

- [ ] **Step 1: Remove body lines and trace line from LiveFooter**

Open `src/cli/components/LiveFooter.tsx`.

Remove the `BodyLineView` import (line 4):
```typescript
import { BodyLineView } from "./BlockView.js";
```

Remove these lines from the JSX (lines 53-58):
```tsx
{(block.kind === "agent" || block.kind === "interactive-agent") && (
  <Text dimColor>
    {"  trace: "}{block.tracePath ?? "…"}
  </Text>
)}
{block.body.map((line, i) => <BodyLineView key={i} line={line} />)}
```

The resulting `LiveFooter` JSX should be:

```tsx
return (
  <Box flexDirection="column">
    <Text>{headerLine(index, block.nodeId, block.label)}</Text>
    {block.gate && (
      <GateSelector options={block.gate.options} onChoose={block.gate.onChoose} />
    )}
    <Text dimColor>{statusLine(block)}</Text>
    {block.kind === "interactive-agent" && (
      <Box>
        <Text color="gray">{"> "}</Text>
        {block.input ? (
          <TextInput
            value={block.input.value}
            onChange={block.input.onChange}
            onSubmit={block.input.onSubmit}
          />
        ) : (
          <Text dimColor>{" "}</Text>
        )}
      </Box>
    )}
  </Box>
);
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -10
```

Expected: `⚡️ Build success`.

- [ ] **Step 3: Run all tests — LiveFooter test must now PASS**

```bash
npx vitest run src/cli/tests/PipelineApp.test.tsx 2>&1
```

Expected: ALL tests pass, including the new LiveFooter test.

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass. Fix any regressions before committing.

- [ ] **Step 5: Commit**

```bash
git add src/cli/components/LiveFooter.tsx
git commit -m "fix: remove body lines and trace from LiveFooter — body is Static, trace is Static"
```

---

## Chunk 4: Verify with Render Log

### Task 5: Confirm render frequency dropped

Context: The debugging session measured 55 renders in 4.8s with a 1-line response. After the fix, LiveFooter should render at the same 10/sec rate but erasing only 2-3 lines max (header + status, optionally gate/input). The render log will confirm this.

- [ ] **Step 1: Add the temporary render log back to LiveFooter**

Add ONE line at the top of LiveFooter component body:

```typescript
export function LiveFooter({ block, index }: { block: LiveBlockWithInput; index: number }) {
  process.stderr.write(`[LF render] body=${block.body.length} kind=${block.kind} t=${Date.now()}\n`);
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Run the pipeline in a fresh tmux window and capture render log**

From your terminal (NOT from inside Claude Code — use a separate shell or the existing `main` tmux session):

```bash
# In a fresh shell (not inside a Claude Code session):
ralph pipeline run pipelines/smoke/agent-implement.dot 2>/tmp/lf-renders-after.txt
echo "Exit: $?"
```

- [ ] **Step 4: Analyze the render log**

```bash
wc -l /tmp/lf-renders-after.txt
cat /tmp/lf-renders-after.txt
```

**Expected findings after fix:**
- Total renders: similar count (~55 for a 4.8s run) — ticker still fires 10/sec
- `body=N` in ALL lines: body counter is ALWAYS 0 (body lines no longer tracked by LiveFooter)
- LiveFooter height: constant 2 lines (header + status), never grows
- Compare against `/tmp/lf-renders-real.txt` (before fix): body count was 0 until end, then spiked to 1; that line count never affected LiveFooter's re-render cost. The key difference is the ANSI sequences.

- [ ] **Step 5: Compare ANSI escape sequences (optional, confirms zero-growth)**

Run from a fresh tmux window:

```bash
# Add this to see raw ANSI before/after
ralph pipeline run pipelines/smoke/agent-implement.dot 2>/dev/null | cat -v | grep -c '\^\['
```

Before fix (from debugging session): each LiveFooter render emitted `ESC[2K ESC[1A` sequences proportional to body line count.

After fix: number of `ESC[1A` (cursor-up) sequences per render should be constant (1-2, just for the header+status footer), never growing.

- [ ] **Step 6: Remove the debug render log**

```typescript
// Remove this line from LiveFooter:
process.stderr.write(`[LF render] body=${block.body.length} kind=${block.kind} t=${Date.now()}\n`);
```

- [ ] **Step 7: Final build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 8: Final test run**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: all tests pass, build clean.

- [ ] **Step 9: Final commit**

```bash
git add src/cli/components/LiveFooter.tsx
git commit -m "fix: remove debug render log from LiveFooter"
```

---

## Chunk 5: Session Memory + Post-Implementation Debugging Guide

### Task 6: Write the implementation memory file

After completing all tasks above, write a memory file documenting what was done. This is for future agents/sessions.

**Memory file path:** `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/2026-04-14-pipeline-tui-flicker-fix.md`

- [ ] **Step 1: Write the memory file at the path above**

The file should contain:

```markdown
# Pipeline TUI Flicker Fix — 2026-04-14

## Root Cause Found

LiveFooter rendered block.body.map(...) outside <Static>. The 100ms ticker
(setInterval 100ms in LiveFooter) caused 10+ full re-renders/sec. Each re-render
caused Ink to erase N+3 lines (header + trace + N body lines + status) and redraw.
With a 30-line response: ~400 line erasures/sec = visible flicker.

Evidence:
- Render log: 55 renders in 4.8s (11.6/sec), all ticker-driven
- ANSI sequences in stdout: [2K[1A[2K[1A[2K[1A patterns confirmed erase+redraw
- implement (StreamOutput): zero cursor-up — uses <Static> for all events

## Fix Applied

1. PipelineApp.tsx: staticItems changed from derived (from state.frozen) to
   grow-only useState. Three new item kinds: block-open (on start), body-line
   (on text/tool_use), block-close (on end via useEffect on state.frozen).
   emit wrapper appends items; block-close appended after reducer confirms freeze.

2. LiveFooter.tsx: removed block.body.map(...) and trace line rendering.
   LiveFooter is now 2-3 lines max (header + status + optional input).
   Ticker still fires 10/sec but only erases 2-3 fixed lines — not N growing lines.

## Files Changed

- src/cli/components/PipelineApp.tsx — grow-only staticItems
- src/cli/components/LiveFooter.tsx — body+trace removed
- src/cli/tests/PipelineApp.test.tsx — LiveFooter isolation test added

## Key Type: StaticItem (in PipelineApp.tsx)

type StaticItem =
  | { kind: "header"; id; pipelineName; pid; goal?; nodes }
  | { kind: "block-open"; id; displayIndex; nodeId; label }
  | { kind: "trace-line"; id; tracePath }
  | { kind: "body-line"; id; line: BodyLine }
  | { kind: "block-close"; id; block: Block }

## Tests

New test: LiveFooter does NOT render body lines (PipelineApp.test.tsx)
Existing tests: all pass — ink-testing-library's lastFrame() includes Static output
```

- [ ] **Step 2: Update MEMORY.md index table**

Open `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/MEMORY.md` and add a row to the Memory Index table:

```
| 2026-04-14 | Pipeline TUI Flicker Fix (body lines to Static) | [→ File](2026-04-14-pipeline-tui-flicker-fix.md) |
```

---

## Appendix: Post-Implementation Debugging Guide

Use this to verify the fix worked and compare against baseline measurements from this session.

### Setup

Source the tmux harness. Run from a shell that is NOT inside a Claude Code session (use a fresh terminal or a `main` tmux window):

```bash
# Source the harness (copy the entire bash block from docs/harness/tmux-drive.md)
# Then:
SESSION="main"
```

### Baseline (BEFORE fix — already measured)

From `2026-04-14` debugging session:
- **Render log:** `/tmp/lf-renders-real.txt` — 55 lines, all `body=0`, ticker-driven
- **ANSI:** `[2K[1A[2K[1A[2K[1A[2K[G` per render (3 cursor-ups = 3 lines erased, body=0)
- **Rate:** ~11.6 renders/sec
- **Mechanism:** LiveFooter erased header + trace + N body lines + status on every render

### Measurement After Fix

**Step 1: Add temporary render log to LiveFooter (same as Task 5 Step 1)**

```bash
# In LiveFooter.tsx, add at top of component:
# process.stderr.write(`[LF render] body=${block.body.length} kind=${block.kind} t=${Date.now()}\n`);
# npm run build
```

**Step 2: Run agent-implement.dot in a fresh tmux window**

```bash
# From a NON-Claude-Code shell:
ralph pipeline run pipelines/smoke/agent-implement.dot 2>/tmp/lf-renders-after.txt
```

**Step 3: Analyze render log**

```bash
wc -l /tmp/lf-renders-after.txt
cat /tmp/lf-renders-after.txt
```

**What to look for (expected after fix):**

| Metric | Before fix | After fix (expected) |
|--------|-----------|----------------------|
| Total renders | ~55 for 4.8s run | ~55 (same — ticker unchanged) |
| `body=` value | Always 0 (body tracked in LiveBlock) | Always 0 (body still in LiveBlock) |
| Cursor-up sequences per render | 3 (header+trace+status) | 2 (header+status only, trace moved to Static) |
| Lines erased with 30-body run | ~33 per render × 12/sec = ~400/sec | ~2 per render × 12/sec = ~24/sec |
| Visible flicker in terminal | Yes — scramble during streaming | None — body lines never erased |

**Step 4: Frame diff during streaming (confirm body lines are stable)**

```bash
# Launch pipeline in tmux window
tmux new-window -t "main:" -n "ralph-test" -d
sleep 1
CMD="ralph pipeline run pipelines/smoke/static-multi-node.dot 2>/dev/null"
tmux send-keys -t "main:ralph-test" -l "$CMD"
tmux send-keys -t "main:ralph-test" Enter

# Capture 3 frames during streaming (2 seconds apart)
sleep 3
tmux capture-pane -p -t "main:ralph-test" > /tmp/frame-after-1.txt
sleep 2
tmux capture-pane -p -t "main:ralph-test" > /tmp/frame-after-2.txt
sleep 2
tmux capture-pane -p -t "main:ralph-test" > /tmp/frame-after-3.txt

# Diff frame 1 vs 2 — body lines should NOT change, only status line changes
diff /tmp/frame-after-1.txt /tmp/frame-after-2.txt
```

**Expected diff output after fix:** Only the status line changes (elapsed time ticks). Body lines, once printed, never reappear in the diff.

**Expected diff output before fix (for comparison):** Every frame diff shows the ENTIRE live block changing — header, all body lines, status — because Ink erased and redrew everything.

**Step 5: Cleanup**

```bash
tmux kill-window -t "main:ralph-test" 2>/dev/null || true
# Remove debug log from LiveFooter, rebuild
npm run build
npx vitest run
```
