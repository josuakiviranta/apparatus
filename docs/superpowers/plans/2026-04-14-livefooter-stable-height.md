---
status: implemented
---

# LiveFooter Stable Height Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate stacked header reprints in the terminal by making `LiveFooter` render at a fixed, stable height from the moment a block starts — so Ink's cursor-tracking never encounters a height mismatch.

**Architecture:** `LiveFooter` currently hides the trace line and input row until the corresponding events arrive (`trace-path` and `interactive-ready`). This causes height growth mid-render: Ink moves the cursor up by the *previous* line count, fails to erase all stale output, and leaves ghost header lines. The fix pre-allocates placeholder lines for `agent` and `interactive-agent` kinds from the first `start` event so the line count never changes.

**Tech Stack:** TypeScript, React 18, Ink (terminal UI), `ink-testing-library` for tests, Vitest.

---

## Background: how Ink re-renders

Ink maintains a "live" dynamic section at the bottom of the terminal. On every re-render it:
1. Moves cursor up N lines (N = lines printed last time)
2. Clears to end of screen
3. Prints the new content

If new content is taller than N, the extra lines at the top of the *previous* render are never erased — they become permanent stale output. With `LiveFooter`'s 100 ms `setInterval` tick, each subsequent render compounds this, printing another copy of the header below the stale one.

Root events and their height impact (interactive-agent node):

| Event | Lines rendered before fix | Lines after fix |
|---|---|---|
| `start` | 2 (header + status) | 4 (header + trace-placeholder + status + input-placeholder) |
| `interactive-ready` | 3 (+input) | 4 (same) |
| `trace-path` | 4 (+trace) | 4 (same, placeholder replaced with real path) |

After the fix the line count is constant at 4 for interactive-agent and 3 for agent.

---

## Files

| Action | Path | What changes |
|---|---|---|
| Modify | `src/cli/components/LiveFooter.tsx` | Add placeholder trace + input rows for agent kinds |
| Modify | `src/cli/tests/LiveFooter.test.tsx` | Update two existing tests that asserted absence of these rows; add new placeholder tests |

No other files change. The reducer, pipeline command, and BlockView are untouched.

---

## Chunk 1: Tests then implementation

### Task 1: Update existing conflicting tests + add new ones

The following two existing tests assert the *old* (buggy) behaviour — they must be updated first so we have a clear red baseline before touching the component.

**Files:**
- Modify: `src/cli/tests/LiveFooter.test.tsx`

- [ ] **Step 1: Read the current test file**

```bash
cat src/cli/tests/LiveFooter.test.tsx
```

Understand the two failing tests before editing:
- `"omits trace path when absent"` — will conflict because we'll now always render a trace row for `interactive-agent`.
- `"omits TextInput when input prop is absent"` — will conflict because we'll now always render an input placeholder row for `interactive-agent`.

- [ ] **Step 2: Update `"omits trace path when absent"` test**

The block in this test uses `kind: "interactive-agent"` (from `makeLive()`). After the fix, a placeholder `  trace: …` line must appear. Update the test:

```typescript
it("shows a placeholder trace line when kind is agent/interactive-agent and tracePath is absent", () => {
  const block = makeLive({ tracePath: undefined });
  const { lastFrame } = render(<LiveFooter block={block} index={1} />);
  const frame = lastFrame() ?? "";
  // A placeholder trace row must exist to keep line count stable
  expect(frame).toMatch(/trace:/);
  expect(frame).toContain("…");
  // But it must NOT show a real path
  expect(frame).not.toMatch(/\.jsonl/);
});
```

- [ ] **Step 3: Update `"omits TextInput when input prop is absent"` test**

The block uses `kind: "interactive-agent"`. After the fix, a disabled `>` placeholder row must appear even without `block.input`. Update:

```typescript
it("shows a disabled input placeholder when kind is interactive-agent and input is absent", () => {
  const block = makeLive({ input: undefined });
  const { lastFrame } = render(<LiveFooter block={block} index={1} />);
  const frame = lastFrame() ?? "";
  // Placeholder prompt row must exist to keep line count stable
  expect(frame).toMatch(/^> /m);
  // But there must be no interactive value content
  expect(frame).not.toContain("what's in src?");
});
```

- [ ] **Step 4: Add test — agent (non-interactive) shows trace placeholder, no input row**

Add a helper and new test after the `makeLive` helper at the top of the `describe("LiveFooter")` block:

```typescript
function makeAgentLive(overrides: Partial<LiveBlockWithInput> = {}): LiveBlockWithInput {
  return makeLive({ kind: "agent", ...overrides });
}
```

Then add the test:

```typescript
it("shows trace placeholder for agent kind before tracePath arrives", () => {
  const block = makeAgentLive({ tracePath: undefined });
  const { lastFrame } = render(<LiveFooter block={block} index={2} />);
  const frame = lastFrame() ?? "";
  expect(frame).toMatch(/trace:/);
  expect(frame).toContain("…");
  expect(frame).not.toMatch(/\.jsonl/);
});

it("shows real trace path for agent kind once tracePath is set", () => {
  const block = makeAgentLive({
    tracePath: "/Users/x/.claude/projects/-cwd/abc.jsonl",
  });
  const { lastFrame } = render(<LiveFooter block={block} index={2} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("trace:");
  expect(frame).toContain("abc.jsonl");
});

it("does not show trace row for non-agent kinds (wait-human)", () => {
  // wait-human gate blocks never have a trace path — no placeholder row
  const { lastFrame } = render(
    <LiveFooter
      block={{
        id: "gate-0",
        nodeId: "g",
        label: "gate",
        kind: "wait-human",
        startedAt: Date.now(),
        body: [],
        stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
        gate: { options: ["Yes"], onChoose: vi.fn() },
      }}
      index={1}
    />
  );
  const frame = lastFrame() ?? "";
  expect(frame).not.toMatch(/trace:/);
});

it("does not show input row for agent (non-interactive) kind", () => {
  const block = makeAgentLive({ tracePath: undefined });
  const { lastFrame } = render(<LiveFooter block={block} index={1} />);
  const frame = lastFrame() ?? "";
  expect(frame).not.toMatch(/^> /m);
});
```

- [ ] **Step 5: Run tests — confirm they fail for the right reasons**

```bash
npx vitest run src/cli/tests/LiveFooter.test.tsx 2>&1 | tail -40
```

Expected: the updated/new tests fail. The existing tests that we did NOT modify still pass. If anything unexpected fails, investigate before continuing.

- [ ] **Step 6: Commit the test changes**

```bash
git add src/cli/tests/LiveFooter.test.tsx
git commit -m "test(LiveFooter): update tests to expect stable-height placeholder rows"
```

---

### Task 2: Implement stable-height placeholder rows in LiveFooter

**Files:**
- Modify: `src/cli/components/LiveFooter.tsx`

- [ ] **Step 1: Read the current implementation**

```bash
cat src/cli/components/LiveFooter.tsx
```

The key sections to change are:
1. The conditional trace line: `{block.tracePath && <Text dimColor>  trace: {block.tracePath}</Text>}`
2. The conditional input section: `{block.input && (...)}`

- [ ] **Step 2: Replace the trace line with a kind-aware renderer**

Change this:

```tsx
{block.tracePath && <Text dimColor>  trace: {block.tracePath}</Text>}
```

To this:

```tsx
{(block.kind === "agent" || block.kind === "interactive-agent") && (
  <Text dimColor>
    {"  trace: "}{block.tracePath ?? "…"}
  </Text>
)}
```

**Why:** `agent` and `interactive-agent` nodes always produce a `.jsonl` trace file. By reserving the row from the first render (using `…` as placeholder), the line count is stable. `wait-human`, `conditional`, `tool`, and `marker` nodes never have trace paths — they keep zero trace rows.

- [ ] **Step 3: Replace the input section with a kind-aware renderer**

Change this:

```tsx
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
```

To this:

```tsx
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
```

**Why:** `interactive-agent` nodes always end up with an input row once `interactive-ready` fires. By rendering a static `> ` row from the first render (before `interactive-ready`), the line count is stable. The placeholder `<Text dimColor>{" "}</Text>` occupies the same visual space without any interactivity.

- [ ] **Step 4: Run the tests — all must pass**

```bash
npx vitest run src/cli/tests/LiveFooter.test.tsx 2>&1 | tail -40
```

Expected: all tests pass, zero failures. If any test still fails, do not proceed — investigate why before adding more changes.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass. If something breaks in `PipelineApp.test.tsx` or `pipeline-app-integration.test.tsx`, read the failure carefully — the change is isolated to rendering logic and should not break reducer or event handling tests.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/cli/components/LiveFooter.tsx
git commit -m "fix(LiveFooter): pre-allocate trace and input rows to stabilize render height

Before this fix, LiveFooter grew in height as events arrived:
- start:             2 lines (header + status)
- interactive-ready: 3 lines (+input)
- trace-path:        4 lines (+trace)

Each height increase caused Ink to underestimate how many lines to erase,
leaving stale header lines visible. With the 100ms setInterval tick, these
accumulated into 60+ repeated headers in the terminal.

After this fix, agent and interactive-agent blocks always render 3 or 4 lines
respectively from the first start event, using '…' and ' ' as placeholders
until the real values arrive."
```

---

---

### Task 3: Tmux smoke run — all pipelines/smoke/*.dot

This task verifies the fix visually using the tmux harness from `docs/harness/tmux-drive.md`. The core assertion for every pipeline is: **the header line `━━ [` appears exactly once per node in the live section**. Stacked headers would show as multiple `━━ [` lines before the status line.

**Prerequisites:**
- `npm run build` completed successfully (Task 2 Step 5)
- A tmux session is active
- Terminal is a known emulator (Terminal, iTerm2, Ghostty, kitty, WezTerm, Alacritty)

- [ ] **Step 1: Source the harness helpers**

Open a shell inside your active tmux session and paste the entire helpers block from `docs/harness/tmux-drive.md`. Nothing executes on paste — the helpers are just function definitions.

Verify sourcing worked:

```bash
type start_run
# Expected: "start_run is a function"
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: exits 0 with no errors.

---

#### Pipeline 1: agent-implement.dot (agent — trace placeholder)

This pipeline is the canonical test for the trace placeholder on a regular `agent` node.

- [ ] **Step 3a: Start the run**

```bash
start_run "ralph pipeline run pipelines/smoke/agent-implement.dot"
```

- [ ] **Step 3b: Wait for the streaming state**

```bash
wait_for_string "streaming" 15000 && capture
```

- [ ] **Step 3c: Read the capture and verify**

```bash
cat "$RUN_DIR/current.txt"
```

Expected in the live section:
- `━━ [1]` appears **exactly once** (no stacking)
- `trace: …` appears (placeholder before sessionId arrives) OR `trace: /Users/` (real path if sessionId arrived fast)
- `⠋ streaming` appears
- No second `━━ [1]` line anywhere above the trace line

```bash
grep -c '━━ \[' "$RUN_DIR/current.txt"
# Expected: 1 (exactly one header line visible)
```

- [ ] **Step 3d: Wait for completion and capture final state**

```bash
wait_for_string "✓ success" 180000 && capture
cat "$RUN_DIR/current.txt"
```

Expected: pipeline completed, `✓ success` visible.

- [ ] **Step 3e: Cleanup**

```bash
cleanup_run clean
```

---

#### Pipeline 2: gate.dot (wait-human — no trace/input row)

This verifies the fix didn't accidentally add trace/input placeholders to `wait-human` gate nodes.

- [ ] **Step 4a: Start the run**

```bash
start_run "ralph pipeline run pipelines/smoke/gate.dot"
```

- [ ] **Step 4b: Wait for the gate prompt**

```bash
wait_for_string "awaiting choice" 15000 && capture
cat "$RUN_DIR/current.txt"
```

Expected in the live section:
- `━━ [1]` appears once
- `trace:` does **NOT** appear (gate nodes have no trace path)
- `> ` does **NOT** appear (gate nodes have no input row)
- `◆ awaiting choice` appears
- Gate options visible (e.g., `1. Proceed`, `2. Abort`)

```bash
grep -c 'trace:' "$RUN_DIR/current.txt"
# Expected: 0
```

- [ ] **Step 4c: Select "Proceed" (option 1)**

```bash
# Gate selector responds to number keys — press 1 then Enter
tmux send-keys -t "$SESSION:$WIN" "1"
wait_stable 3000 || true
tmux send-keys -t "$SESSION:$WIN" Enter
wait_for_string "success" 15000 && capture
```

- [ ] **Step 4d: Cleanup**

```bash
cleanup_run clean
```

---

#### Pipeline 3: chat-only.dot (interactive-agent — trace + input placeholders)

This is the **primary regression test** for the bug. It exercises the `interactive-agent` node that was producing 60+ stacked headers.

- [ ] **Step 5a: Start the run**

```bash
start_run "ralph pipeline run pipelines/smoke/chat-only.dot"
```

- [ ] **Step 5b: Wait for the awaiting state**

```bash
wait_for_string "awaiting" 15000 && capture
cat "$RUN_DIR/current.txt"
```

Expected in the live section:
- `━━ [1]` appears **exactly once** (the bug would produce 10+ copies here)
- `trace:` appears (either `trace: …` placeholder or real path)
- `> ` appears on its own line (input prompt — either active TextInput or placeholder)
- `● awaiting` appears

```bash
grep -c '━━ \[' "$RUN_DIR/current.txt"
# Expected: 1 (the fix is working if this is 1, not 10+)
```

- [ ] **Step 5c: Send /end to close the interactive session**

```bash
send_input "/end"
wait_for_string "success" 30000 && capture
cat "$RUN_DIR/current.txt"
```

Expected: chat node shows `✓ success`, pipeline completes.

- [ ] **Step 5d: Cleanup**

```bash
cleanup_run clean
```

---

#### Pipeline 4: chat-end-to-end.dot (interactive-agent + fallback agent)

Same interactive-agent check, plus verifies multi-node pipeline still renders correctly after the interactive node completes.

- [ ] **Step 6a: Start the run**

```bash
start_run "ralph pipeline run pipelines/smoke/chat-end-to-end.dot"
```

- [ ] **Step 6b: Wait for awaiting, verify, send /end**

```bash
wait_for_string "awaiting" 15000 && capture
grep -c '━━ \[' "$RUN_DIR/current.txt"
# Expected: 1
send_input "/end"
```

- [ ] **Step 6c: Wait for the second agent node (chat_summarizer/fallback) to complete**

```bash
wait_for_string "success" 120000 && capture
cat "$RUN_DIR/current.txt"
```

Expected: both nodes show in `<Static>` section with `✓ success`. Headers appear once each.

- [ ] **Step 6d: Cleanup**

```bash
cleanup_run clean
```

---

#### Pipeline 5: conditional.dot (conditional node — no trace row)

- [ ] **Step 7a: Start, wait for completion, verify**

```bash
start_run "ralph pipeline run pipelines/smoke/conditional.dot"
wait_for_string "success" 30000 && capture
cat "$RUN_DIR/current.txt"
grep -c 'trace:' "$RUN_DIR/current.txt"
# Expected: 0 (conditional nodes have no trace row)
cleanup_run clean
```

---

#### Pipeline 6: tool.dot (tool node — no trace row)

- [ ] **Step 8a: Start, wait for completion, verify**

```bash
start_run "ralph pipeline run pipelines/smoke/tool.dot"
wait_for_string "success" 30000 && capture
cat "$RUN_DIR/current.txt"
grep -c 'trace:' "$RUN_DIR/current.txt"
# Expected: 0 (tool nodes have no trace row)
cleanup_run clean
```

---

- [ ] **Step 9: Final commit**

All pipelines passed. Record the smoke test result:

```bash
git commit --allow-empty -m "chore: smoke test all pipelines/smoke/*.dot — stable header verified"
```
