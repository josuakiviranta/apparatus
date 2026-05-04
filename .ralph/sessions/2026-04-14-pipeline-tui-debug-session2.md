# Pipeline TUI Debugging Session 2 (2026-04-14)

Two critical bugs fixed in ralph-cli's pipeline TUI through systematic debugging using the tmux harness.

---

## Bug 1: Body Lines and Outcome Line Indentation

**Symptom:** In the pipeline TUI, `you:` / `claude:` body lines and the frozen `✓ success` outcome line rendered at column 0, while the `trace:` line and live status line had 2-space indentation.

**Root Cause:**
- `BodyLineView` in `src/cli/components/BlockView.tsx` had no margin wrapper
- `outcomeLine()` string in `BlockView.tsx` had no leading spaces (inconsistent with `statusLine()` in `LiveFooter.tsx` which already included `  ` prefix)

**Fix Applied:**
1. Wrapped both branches of `BodyLineView` in `<Box marginLeft={2}>` (applies to both `BlockView` and `LiveFooter`)
2. Updated `outcomeLine()` first part from `` `${glyph} ${block.outcome.status}` `` to `` `  ${glyph} ${block.outcome.status}` ``

**Tests Added:**
- `BlockView.test.tsx`: "indents outcome line with 2 spaces" and "indents body text lines with 2 spaces"
- `LiveFooter.test.tsx`: "indents body text lines with 2 spaces"

**Commit:** 94b8fa8

---

## Bug 2: `$chat.output` Empty in Downstream Nodes

**Symptom:** The `summarize` node prompt uses `$chat.output` but always produced "No messages were exchanged in this chat session." despite the chat node having a real multi-turn conversation.

**Root Cause:**
Data flow desync in `agent-handler.ts`:
1. Session created at line 99
2. `agent.runInteractive()` called at line 102 → returns `ChildHandle` with `.events` async generator
3. `onInteractiveRequest()` callback in `pipeline.ts` **consumes** `child.events` → pipes to TUI via `parseClaudeEvent` but **never writes to `session.history`**
4. `buildSessionDigest(session)` called at line 133 → `lastAssistantText()` scans empty `session.history` → returns `""`
5. `context["chat.output"] = ""` → downstream nodes see empty `$chat.output`

The test stub `makeInteractiveStub` in `agent-handler-interactive.test.ts` already showed the correct pattern: push `result` events into `session.history`. Production code was missing those lines.

**Fix Applied:**
In `pipeline.ts` event loop (line ~134), when `raw.type === "result"` and `raw.text` is non-empty, push to `session.history`:

```typescript
session.history.push({
  role: "assistant",
  text: raw.text,
  toolCalls: [],
  usage: raw.usage,
  at: Date.now(),
});
```

**Test Added:**
`pipeline.test.ts`: "pipelineRunCommand — onInteractiveRequest > populates session.history with assistant turns so $node.output is available downstream"
- Captures the `onInteractiveRequest` callback from `runPipeline` mock call args
- Exercises it with a `FakeChildHandle` emitting a `result` event
- Asserts `session.history` contains one assistant turn with correct text

**Commit:** 8482a2e

---

## Key Files Modified
- `src/cli/components/BlockView.tsx` — `BodyLineView` margin, `outcomeLine()` spacing
- `src/cli/components/LiveFooter.tsx` — tested via BlockView changes
- `src/cli/commands/pipeline.ts` — event loop for interactive callbacks
- `src/cli/lib/session.ts` — `buildSessionDigest()`, `lastAssistantText()`
- `src/attractor/handlers/agent-handler.ts` — session creation, digest building, callback invocation

---

## Tmux Debugging Workflow Lessons

Sourced helpers from `docs/harness/tmux-drive.md`. Key patterns used:
- `start_run` → spawn process in background tmux pane
- `wait_for_string "awaiting"` → **critical for interactive pipeline nodes** (not just `wait_stable`)
- `send_input` → inject user input after interactive state confirmed
- `wait_stable` → let TUI settle after input
- `capture` → snapshot stdout for assertion
- `cleanup_run` → orphan recovery

**Key lesson:** Always use `wait_for_string "awaiting"` before `send_input` for interactive pipeline nodes. The TUI needs explicit interactive state signal, not just output stability.

---

## Status
Both bugs root-caused, fixed, and tested. Pipeline now correctly indents TUI output and propagates chat context to downstream nodes.
