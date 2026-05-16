# Surface `keymap.help` in interactive-agent footer — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the already-authored `keymap.help` hint string above the input in `agentDriver.renderFooter` so users inside an interactive chat see in-band slash-command cues (`/end /abort /help /edit-instructions · Esc to abort`).

**Architecture:** One TUI render-tree edit. Wrap the existing `Box` inside `renderFooter` (`src/cli/lib/interactions/drivers/agent.tsx:27-39`) in `<Box flexDirection="column">` and prepend `<Text dimColor>{HELP_HINT}</Text>`. Hoist the literal already at `keymap.help` (line 45) to a module-scoped `const HELP_HINT` so the hint and the keymap share one source of truth. RED-first test in `src/cli/tests/LiveFooter.test.tsx` asserts `lastFrame()` contains `/edit-instructions`. No driver-contract change, no other surface moves.

**Tech Stack:** TypeScript, React, Ink, ink-testing-library, vitest.

**Source of truth:** `docs/superpowers/specs/2026-05-16-interactive-chat-agents-lack-orientation-phase-design.md`.

> **Re-entry note.** The previous version of this plan (and design doc) covered a broader orientation block — `GROUNDED_OPENING_BLOCK`, scenario fixtures, agent .md edits. That work shipped earlier (search git for `GROUNDED_OPENING_BLOCK`). This re-entry **replaces** the prior plan file and covers only the residual footer-hint slice: the hint string exists at `keymap.help` but `renderFooter` never renders it. Commit `c05374a` (2026-05-16) silently dropped the render call when the footer was swapped to `MultilineTextInput`. Working tree shows `M src/cli/lib/interactions/drivers/agent.tsx` from a since-reverted chat-session edit — the implementing session should `git checkout src/cli/lib/interactions/drivers/agent.tsx` before starting so the RED test fails against the true regressed state.

---

## Chunk 1: Render `keymap.help` in `agentDriver.renderFooter` (RED → GREEN)

This is the only chunk. Scope per design §4 and §8: two file edits, ~22 LOC total, atomic landing.

**Files:**
- Modify: `src/cli/lib/interactions/drivers/agent.tsx` (replace lines 14-52; the `renderFooter` method at 27-39 and the `keymap.help` literal at line 45 are the substantive edits)
- Test: `src/cli/tests/LiveFooter.test.tsx` (append one `it()` block after the existing *renders the agent driver's TextInput…* case at line 44)

**Symbol-shape consumers cross-check:** No exported symbol signature changes.
- `agentDriver` keeps the same exported `InteractionDriver<"interactive-agent">` shape; consumers (`src/cli/lib/interactions/drivers/index.ts`) re-export untouched.
- `renderFooter` still returns `ReactNode` per `src/cli/lib/interactions/driver.ts:31`.
- `keymap.help` value is byte-identical (the literal is hoisted to a module-scoped `const HELP_HINT`, same string).
- `__agentStatesForTest` export is untouched.
- Greppable consumers of these symbols (`agentDriver`, `__agentStatesForTest`) do not see a shape change.

No consumer chunks exist in this plan; no `plan_writer.under_declared_shape_consumer_suspected` entries to emit.

---

- [x] **Step 1.1: Reset the working tree if needed**

The pipeline-context noted `M src/cli/lib/interactions/drivers/agent.tsx` from a chat-session edit that was reverted at the conversation level but may still show up as a working-tree modification. Before writing the test, confirm `git status` and reset if the file is dirty:

```bash
git status -- src/cli/lib/interactions/drivers/agent.tsx
```

If the file shows as modified, run:

```bash
git checkout -- src/cli/lib/interactions/drivers/agent.tsx
```

Expected: working-tree clean. The driver should match the pre-edit state described in design §1 (the unrendered-hint regression).

- [x] **Step 1.2: Add the failing test (RED)**

Open `src/cli/tests/LiveFooter.test.tsx`. After the existing `it("renders the agent driver's TextInput for interactive-agent kind", …)` block that ends at line 44, and before the next `it("renders the gate driver's GateSelector …")` at line 46, insert this new `it()` block:

```tsx
  it("renders the keymap.help hint above the input for interactive-agent kind", () => {
    const blk = block("interactive-agent", "a-help");
    __agentStatesForTest.set("a-help", {
      child: { kill: vi.fn() } as never,
      onDone: vi.fn(),
    });
    const { lastFrame } = render(
      <LiveFooter
        block={blk}
        inputBuffer=""
        onInputChange={() => {}}
        onInputSubmit={async () => {}}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("/edit-instructions");
  });
```

Rationale (design §3.3, §7.5):
- Mirrors the existing case at lines 27-44 (same `__agentStatesForTest` setup, same `render(<LiveFooter …/>)`, same `lastFrame()` shape).
- Probes the substring `/edit-instructions` rather than the full hint string because (a) it is the discoverability-critical command the regression hid, (b) it is unique to the slash-commands surface in the repo's UI (no incidental matches in unrelated tests), (c) substring captures the contract without freezing wording for future hint edits.

- [x] **Step 1.3: Run the test to confirm it fails**

Run:

```bash
npx vitest run src/cli/tests/LiveFooter.test.tsx
```

Expected: 6 passes, 1 fail. The failing block is the new one; the assertion message looks roughly like:

```
AssertionError: expected '> ▌  ● awaiting · 0 turns · …' to contain '/edit-instructions'
```

If the test passes immediately, stop — either the implementation already exists or the assertion is broken. Investigate before proceeding (most likely cause: working tree was not reset in Step 1.1 and a half-applied edit is in place).

- [x] **Step 1.4: Implement the driver edit (GREEN)**

Edit `src/cli/lib/interactions/drivers/agent.tsx`. Replace lines 14-52 with the block below. The diff vs. current code is:
1. New `const HELP_HINT = "/end /abort /help /edit-instructions · Esc to abort";` between the `__agentStatesForTest` export and the `agentDriver` const.
2. `renderFooter` wraps its existing `Box` in `<Box flexDirection="column">` and prepends `<Text dimColor>{HELP_HINT}</Text>`.
3. `keymap.help` references `HELP_HINT` instead of the inline literal.

Full replacement for lines 14-52 of `src/cli/lib/interactions/drivers/agent.tsx`:

```tsx
const states = new Map<string, AgentState>();

// Exported for tests only — never imported by production code.
export const __agentStatesForTest = states;

const HELP_HINT = "/end /abort /help /edit-instructions · Esc to abort";

export const agentDriver: InteractionDriver<"interactive-agent"> = {
  kind: "interactive-agent",
  initState: () => undefined,
  reduce(payload: DriverPayload, state: LiveBlock): LiveBlock {
    if (payload.driver !== "interactive-agent") return state;
    states.set(state.id, { child: payload.child, onDone: payload.onDone });
    return state;
  },
  renderFooter(_block: LiveBlock, ctx: DriverRenderCtx) {
    return (
      <Box flexDirection="column">
        <Text dimColor>{HELP_HINT}</Text>
        <Box>
          <Text color="gray">{"> "}</Text>
          <MultilineTextInput
            prefixWidth={2}
            value={ctx.inputBuffer}
            onChange={ctx.onInputChange}
            onSubmit={ctx.onInputSubmit}
          />
        </Box>
      </Box>
    );
  },
  keymap: {
    escape: (block) => {
      const s = states.get(block.id);
      s?.child.kill("SIGTERM").catch(() => {});
    },
    help: HELP_HINT,
  },
  onFreeze(live): Partial<Block> {
    const s = states.get(live.id);
    states.delete(live.id);
    return s ? { onDone: s.onDone } : {};
  },
};
```

Decisions encoded in the code block above (design §7.2, §7.3):
- **Module-scoped `const HELP_HINT`** (not `agentDriver.keymap.help` self-reference). The self-reference triggers TypeScript's "used before assigned" path on object literals during initialisation; the module-const form is unambiguous and equally deep-modules-compliant.
- **`<Text dimColor>`** (not `<Text color="gray">`) — matches `statusLine` styling at `src/cli/components/LiveFooter.tsx:54`. Both are advisory text subordinate to the active input. `gray` would visually compete with the caret.

No new imports are needed: `Box`, `Text`, `MultilineTextInput` are already imported at lines 3 and 7 of the current file.

- [x] **Step 1.5: Run the test to confirm it passes (GREEN)**

Run:

```bash
npx vitest run src/cli/tests/LiveFooter.test.tsx
```

Expected: 7 passes, 0 fails. The new `renders the keymap.help hint above the input for interactive-agent kind` block now passes. The existing six cases (lines 27-127) continue to pass — the substring assertions at lines 42-43 (`>` and `hello`) still hold under the new column-flex layout, and the `not.toContain(">"`)`/`not.toContain("Approve")` assertions for non-interactive kinds (lines 80-93) still hold because the gate driver's `renderFooter` is unchanged.

- [x] **Step 1.6: Run the full vitest suite to catch incidental regressions**

Run:

```bash
npx vitest run
```

Expected: full green. The substring `/edit-instructions` is unique to the slash-commands surface (verified via design §3.3 and §10.2), so no unrelated assertion should flip. If a snapshot test breaks, investigate before auto-updating — there is no snapshot test on the interactive-agent footer in the current repo, so a failure here is unexpected and merits a pause.

- [x] **Step 1.7: Run the TypeScript checker**

Run:

```bash
npx tsc --noEmit
```

Expected: clean. No new imports; the hoisted `const HELP_HINT` is plain string; `keymap.help` already had type `string` per `src/cli/lib/interactions/driver.ts` (the `keymap.help` field).

- [x] **Step 1.8: Manual smoke (recommended)**

Per design §6, §10.3 — visual sanity check that the column-flex render landed correctly:

1. Run: `apparat pipeline run illumination-to-implementation` (or any pipeline that lands on an `interactive: true` agent node such as a `chat_session` or `chat_refiner`).
2. When the chat block opens, confirm the line `/end /abort /help /edit-instructions · Esc to abort` appears in dim text directly **above** the `> ` caret.
3. Confirm the status line (`● awaiting · N turns · X/Y tok · Ms`) still sits **below** the input — it is rendered by `LiveFooter` at line 54 of `src/cli/components/LiveFooter.tsx` and was not edited.
4. Type `/edit-instructions` in the chat. Behavior should be identical to today — this design only surfaces the hint, not the command itself.

Diagnostic checklist if the smoke looks wrong:
- Hint missing entirely → `flexDirection="column"` did not land on the outer `Box`. Re-check the edit.
- Hint appears below the input instead of above → the order of the new `<Text>` and the inner `<Box>` was swapped. Restore the order in Step 1.4's code block (hint first, input second).
- Hint appears in bright color instead of dim → `dimColor` attribute is missing on the new `<Text>` element.

- [x] **Step 1.9: Commit**

```bash
git add src/cli/lib/interactions/drivers/agent.tsx \
        src/cli/tests/LiveFooter.test.tsx
git commit -m "$(cat <<'EOF'
fix(agent-driver): render keymap.help hint above input

The interactive-agent driver authored a help hint at keymap.help but
renderFooter never rendered it after commit c05374a swapped to
MultilineTextInput. Wrap the footer in a column-flex Box and prepend
a dim Text line so /end /abort /help /edit-instructions · Esc to
abort is visible above the caret. Hoist the literal to a
module-scoped HELP_HINT so renderFooter and keymap.help share one
source of truth.

RED-first test in LiveFooter.test.tsx asserts lastFrame() contains
/edit-instructions for an interactive-agent block.

Design: docs/superpowers/specs/2026-05-16-interactive-chat-agents-lack-orientation-phase-design.md
EOF
)"
```

## Verification targets

- Smokes: `None` — design §6 explicitly notes no new scenario folder. Existing `.apparat/scenarios/interaction-driver-escape/` and `.apparat/scenarios/chat-end-to-end/` exercise the `interactive-agent` driver end-to-end without asserting footer text and continue to pass unchanged.
- Manual exercises: `apparat pipeline run illumination-to-implementation` (or any pipeline with an `interactive: true` agent node such as `chat_session`/`chat_refiner`). Visually confirm the dim hint line `/end /abort /help /edit-instructions · Esc to abort` appears directly above the `> ` caret in the interactive-agent footer, and the `● awaiting · N turns …` status line still sits below the input.
- Lint: `npx vitest run src/cli/tests/LiveFooter.test.tsx` (7 `it()` blocks all green, including the new `renders the keymap.help hint above the input for interactive-agent kind` block) and `npx tsc --noEmit` (no new imports, clean).
- Surfaces touched: `interactive-agent` driver (`src/cli/lib/interactions/drivers/agent.tsx`) and its co-located test (`src/cli/tests/LiveFooter.test.tsx`). One surface.

---

## Open questions (carried from design §9)

1. **Gate-driver parity** — `src/cli/lib/interactions/drivers/gate.tsx:40` has its own unrendered `keymap.help` (`↑↓ · Enter / 1-N · Esc to abort`). Design §7.1 defers this; this plan keeps it out of scope. If accepted as a follow-up illumination, the symmetrical edit is: prepend `<Text dimColor>{HELP_HINT}</Text>` to `gateDriver.renderFooter`, hoist the literal to a `const`, add a parallel RED test in `LiveFooter.test.tsx` asserting `lastFrame()` contains `↑↓` for the `wait-human` kind.
2. **Hint placement (above vs. below the input)** — Design §9 notes "below the input, above the status line" as an alternative layout. This plan defaults to **above** (as in Step 1.4's code block) following the design's §3.1 decision. The RED assertion is placement-agnostic (`toContain` substring match), so a future flip would not break the test — the implementing session can flip the order in Step 1.4 if they have a strong layout preference, but the default is above.
3. **TypeScript form choice** — Step 1.4 picks module-scoped `const HELP_HINT` over `agentDriver.keymap.help` self-reference. If the implementing session wants to try the self-reference form first, the test is identical and the choice is purely TypeScript ergonomics; document the choice in the commit body if it diverges from the default.
