## Design: TextInput clips and slides to stop terminal-wrap duplication

**Date:** 2026-05-14
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-14T1525-textinput-terminal-wrap-causes-duplication.md`

## 1. Motivation

`TextInput` (`src/cli/components/TextInput.tsx:108-114`) renders the input buffer as three consecutive `<Text>` segments with no horizontal bound:

```tsx
<Box>
  <Text>{before}</Text>
  <Text inverse>{at}</Text>
  <Text>{after}</Text>
</Box>
```

When the rendered string exceeds the terminal's column width, the terminal hard-wraps the line onto a second row. Ink's reconciler still treats the input as a single row — on the next keystroke it moves the cursor up by one row and overwrites, leaving the previously wrapped row in the scrollback. Users see this as **the input duplicating with every new keystroke** once the buffer crosses roughly the 78-character mark. Arrow-key navigation looks confused for the same reason: the inverse-block cursor falls onto whichever wrapped row Ink thinks it owns, not the visual row the user sees.

The component is rendered inside `agentDriver.renderFooter` at `src/cli/lib/interactions/drivers/agent.tsx:30-31`, immediately below a `<Text color="gray">{"> "}</Text>` prefix. This is the primary interactive surface of the chat-refinement UX called out in README and anchored by ADR-0014 (Interaction-kind drivers); the bug fires on the exact path where users craft careful prompts to an agent.

### What this design closes

- The "terminal duplicates each keystroke once my input gets long" bug observed by the operator on 2026-05-14: *"often when the input text hits the sides of input area certain way the output in terminal starts to dublicate with every new key stroke."*
- The secondary "arrow keys behave weirdly when I try to edit earlier in a long line" symptom — same root cause (Ink's single-row assumption vs the terminal's hard wrap).

### What this design explicitly does **not** close

- Multi-line input, soft-wrap, or word-boundary scrolling. The chat input remains a single visual row; the fix slides that row sideways. Multi-line composition is a separate UX surface.
- Changes to Ink itself, to the parent layout, or to other interaction drivers. The seam is one component plus one caller.
- Re-architecting `InteractionDriver` or ADR-0014. The driver contract is unchanged.

## 2. Decision summary

A single component change plus one caller line plus a regression test.

1. **Extend `TextInput` props with `prefixWidth?: number` (default `0`)** at `src/cli/components/TextInput.tsx:4-11`. The caller declares how many columns are already consumed on the row by adjacent siblings, so `TextInput` can compute its own usable width.

2. **Replace the unbounded render at `src/cli/components/TextInput.tsx:104-114` with a clipped sliding window.** Compute `availableCols = max(10, (process.stdout.columns ?? 80) - prefixWidth - 1)`. Derive `viewStart`/`viewEnd` around `cursor`, slice `before`/`at`/`after` from that window, and prepend/append dim `‹` / `›` indicators when content is hidden on either side. Indicators consume one column each and subtract from `availableCols` when present.

3. **Update the one production caller** at `src/cli/lib/interactions/drivers/agent.tsx:28-37` (the `renderFooter` Box; `"> "` on `:30`, `<TextInput …/>` spans `:31-35`) to pass `prefixWidth={2}` (the `"> "` prefix is exactly 2 columns).

4. **Add a regression test** in `src/cli/tests/TextInput.test.tsx`. Render with `"a".repeat(200)` and an explicit narrow `prefixWidth`. Assert `stripAnsi(lastFrame()).length <= availableCols + prefixWidth` and that the inverse-block cursor is visible in the output.

No `.dot` schema change, no driver contract change, no ADR rewrite, no engine touch.

## 3. Architecture

### 3.1 Component shape

`TextInput` continues to own:

- Buffer state (`internal`, `cursor`) and the `useInput` reducer at `src/cli/components/TextInput.tsx:39-94`. Unchanged.
- The placeholder fast path at `src/cli/components/TextInput.tsx:96-102`. Unchanged.

`TextInput` newly owns:

- `prefixWidth` as an optional column-budget input from the caller.
- A view-window computation that runs every render and produces `(viewStart, viewEnd, leftMarker, rightMarker)`.
- The clipped slice of `before` / `at` / `after` that gets handed to the three `<Text>` segments.

The caller is responsible for one fact only: how many columns it has already burned on the same row. It is not responsible for measuring the terminal or for knowing how `TextInput` slices internally.

### 3.2 Sliding window algorithm

Given `internal.length === N` (treat the cursor's resting position past EOL as index `N`, length `N + 1` for budget purposes — the inverse-block cursor occupies one cell even on an empty tail):

```
columns       = process.stdout.columns ?? 80
reserve       = 1                            # block cursor at EOL
budgetGross   = max(10, columns - prefixWidth - reserve)

# Anchor the window so the cursor sits ~70% of the way across.
# 0.7 chosen so typing past the right edge feels like the line is
# "scrolling under the cursor" (matches address-bar UX from explainer).
desiredStart  = max(0, cursor - floor(budgetGross * 0.7))
viewStart     = min(desiredStart, max(0, (N + 1) - budgetGross))
viewEnd       = min(N + 1, viewStart + budgetGross)

# Provisional marker decision based on the gross window.
leftMarker    = viewStart > 0
rightMarker   = viewEnd   < N + 1

# Indicators steal one column each when active. Shrink the budget,
# but also re-anchor viewStart so the cursor stays visible when the
# window was right-pinned (cursor near EOL).
budgetNet     = budgetGross - (leftMarker ? 1 : 0) - (rightMarker ? 1 : 0)
viewStart     = min(viewStart, max(0, (N + 1) - budgetNet))
viewEnd       = min(N + 1, viewStart + budgetNet)

# Markers can flip after the re-anchor — recompute against the net window.
leftMarker    = viewStart > 0
rightMarker   = viewEnd   < N + 1

# Invariant: cursor ∈ [viewStart, viewEnd). If a degenerate input
# violates this (should not happen given the clamps above), fall back
# to a cursor-centered window of width budgetNet.
```

The 70% anchor is deliberate (and noted in source as a single one-liner): the cursor lives toward the right of the view while there is more text to the right, which matches the address-bar analog the user approved in the explainer.

Cursor-visibility cases this covers:

- `cursor = 0`: `desiredStart = 0`, `viewStart = 0`, `leftMarker = false`. Cursor is the first visible cell.
- `cursor = N` (EOL): the right-pin clamp pulls `viewStart` to `(N+1) - budget`; `viewEnd = N+1`. If `leftMarker = true`, the re-anchor step pulls `viewStart` one further column right so the EOL cell remains inside the net window.
- Both markers active mid-buffer: net window is `budgetGross - 2` wide; the re-anchor keeps `cursor < viewEnd` because `viewStart` only moves right when it has to.

### 3.3 Render shape

After the algorithm runs, the `<Box>` body becomes (pseudo-JSX):

```tsx
<Box>
  {leftMarker  ? <Text dimColor>‹</Text> : null}
  <Text>{before.slice(viewStart, cursor)}</Text>
  <Text inverse>{at}</Text>
  <Text>{after.slice(0, max(0, viewEnd - (cursor + 1)))}</Text>
  {rightMarker ? <Text dimColor>›</Text> : null}
</Box>
```

The three `<Text>` segments are preserved so the existing ink-testing-library assertions (`expect(lastFrame()).toContain("hell")` etc.) continue to read the visible characters.

### 3.4 Caller change

At `src/cli/lib/interactions/drivers/agent.tsx:30-31`:

Before:
```tsx
<Box>
  <Text color="gray">{"> "}</Text>
  <TextInput value={ctx.inputBuffer} onChange={ctx.onInputChange} onSubmit={ctx.onInputSubmit} />
</Box>
```

After:
```tsx
<Box>
  <Text color="gray">{"> "}</Text>
  <TextInput
    prefixWidth={2}
    value={ctx.inputBuffer}
    onChange={ctx.onInputChange}
    onSubmit={ctx.onInputSubmit}
  />
</Box>
```

The `2` is grounded: the rendered prefix is the literal string `"> "`, two characters wide. No other production caller exists (`grep -rn TextInput src/cli` returns one production caller plus three test files).

### 3.5 Test shape

New cases in `src/cli/tests/TextInput.test.tsx`:

1. **Clip-to-width** — render `<TextInput value={"a".repeat(200)} prefixWidth={4} ... />` inside `Harness`. Compute `bound = max(10, (process.stdout.columns ?? 80) - 4 - 1) + 4` — i.e. `max(10, columns - prefixWidth - 1) + prefixWidth`, matching the `availableCols` floor of `10` from §3.2 so the assertion holds even in narrow CI terminals. Assert `stripAnsi(lastFrame()).length <= bound`. Assert the inverse-block cursor cell is present in `lastFrame()`.
2. **Left marker appears when scrolled past the start** — drive enough printable input that `viewStart > 0`, assert `lastFrame()` contains `‹`.
3. **Right marker appears when buffer extends past the view** — render a long buffer and move the cursor home with `Ctrl-A` (already supported at `src/cli/components/TextInput.tsx:72-76`), assert `lastFrame()` contains `›`.

Existing assertions in `TextInput.test.tsx` (`shows placeholder`, `appends printable`, `backspace deletes`, `Enter submits`, `disabled ignores`, `left/right arrows`) all use short buffers that fit inside any sensible terminal and continue to pass without modification.

## 4. Code anchors

- `src/cli/components/TextInput.tsx:4-11` — `Props` interface, gains `prefixWidth?: number`.
- `src/cli/components/TextInput.tsx:96-102` — placeholder branch, unchanged.
- `src/cli/components/TextInput.tsx:104-114` — render block, replaced with the clipped sliding-window JSX from §3.3.
- `src/cli/lib/interactions/drivers/agent.tsx:28-37` — sole production caller (`renderFooter` `<Box>`); `"> "` text at `:30`, `<TextInput …/>` spans `:31-35`. Gains `prefixWidth={2}`.
- `src/cli/tests/TextInput.test.tsx` — new cases per §3.5.
- ADR `docs/adr/0014-interaction-kind-drivers.md` — referenced for the driver seam; no edit required.

## 5. Blast radius / impact surface

- **Size:** S.
- **Surfaces crossed:**
  - One Ink component (`src/cli/components/TextInput.tsx`).
  - One interaction driver (`src/cli/lib/interactions/drivers/agent.tsx`).
  - Unit + integration tests (`src/cli/tests/TextInput.test.tsx` definite; `src/cli/tests/LiveFooter.test.tsx` and `src/cli/tests/pipeline-run-view.test.tsx` only if they currently snapshot footer width — both reference `TextInput` only as the mounted component, not by frame width, so neither is expected to need a touch-up).
- **Breaking changes:** none. `prefixWidth?: number` defaults to `0`; `onChange` / `onSubmit` value shape is unchanged; existing callers that omit the prop continue to render as today, except they now also clip to terminal width instead of wrapping — a strict improvement, no API break.
- **Update checklist:**
  - [ ] `src/cli/components/TextInput.tsx` — prop + sliding-window render.
  - [ ] `src/cli/lib/interactions/drivers/agent.tsx` — pass `prefixWidth={2}`.
  - [ ] `src/cli/tests/TextInput.test.tsx` — three new cases (clip, left marker, right marker).
  - [ ] `docs/adr/0014-interaction-kind-drivers.md` — **optional** addendum noting that drivers may pass column hints (e.g. `prefixWidth`) to their footer components. Driver seam contract itself is unchanged, so this is documentation polish, not a required edit.
  - [ ] `README.md` — no change. The chat-refinement section already promises a working interactive input; this is bug-fix parity.
  - [ ] `CONTEXT.md` — no glossary addition. `prefixWidth` is a component-local prop, not domain vocabulary.

## 6. Open questions

- **Are `‹` / `›` safe everywhere?** Both are U+2039 / U+203A (single guillemets), present in every default macOS terminal font and in the test harness's `ink-testing-library`. If a CI terminal in a future hosted runner lacked them, the symptom would be a `?` glyph — degraded UX but not broken behavior. **Default: ship as `‹` / `›`; revisit only if a real environment renders them as tofu.**
- **Should the 70% cursor anchor be a constant or a prop?** Argument for prop: future drivers might want a different reading position. Argument against: no second caller today, and YAGNI. **Default: hard-coded as a `const VIEW_CURSOR_RATIO = 0.7` in `TextInput.tsx`; promote to a prop only when a second caller needs a different value.**
- **Does the view need to handle terminal resize mid-typing?** `process.stdout.columns` is read on every render, and `useInput` re-renders on each keystroke, so resize-then-keystroke recovers automatically. Resize without a subsequent keystroke leaves the previous frame stale until the next render. **Default: accepted limitation; no `process.stdout.on("resize", …)` listener added, since the next keystroke fixes it and the cost of a global listener inside a component is not warranted.**

## 7. Verification targets

- **Unit tests:** `npx vitest run src/cli/tests/TextInput.test.tsx`. New cases assert frame-width bound, left-marker visibility, right-marker visibility, and cursor visibility under clipping. Existing six cases continue to pass.
- **Type-check:** `npx tsc --noEmit`. New optional prop is additive; consumers without it must continue to compile.
- **Manual exercise:**
  - Run `apparat meditate <folder>` (or any pipeline that mounts `agentDriver`), open the interactive chat, paste a 200-character sentence, type more at the end. Expected: input stays on one row, `›` indicator visible while cursor is mid-buffer, `‹` indicator visible after `Ctrl-A` home, no duplicated rows in scrollback.
  - Repeat with `apparat implement <folder>` to confirm no driver-specific regression (implement uses a different driver but renders no `TextInput` footer today; this is a smoke check that nothing breaks in shared `LiveFooter`).
- **No new smokes:** the change is a TUI rendering fix; no `.apparat/scenarios/*.dot` fixture exercises terminal-width behavior, and adding one would be out of scope per the brainstorming skill's "do not expand scope" guideline.
