## Design: MultilineTextInput replaces the sliding-window chat footer

**Date:** 2026-05-16
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-16T1333-textinput-wrong-ux-model-multirow-is-right.md`
**Predecessor design:** `docs/superpowers/specs/2026-05-14-textinput-terminal-wrap-causes-duplication-design.md`

## 1. Motivation

The predecessor design landed the sliding-window fix at `src/cli/components/TextInput.tsx:121-124`:

```ts
const VIEW_CURSOR_RATIO = 0.7;
let viewStart = Math.max(0, cursor - Math.floor(budgetGross * VIEW_CURSOR_RATIO));
viewStart = Math.min(viewStart, Math.max(0, logicalLen - budgetGross));
let viewEnd = Math.min(logicalLen, viewStart + budgetGross);
```

It cured the Ink reconciler duplication (terminal hard-wrap → row-count mismatch → keystroke-driven scrollback duplication) by constraining the rendered row to one terminal-width slice plus dim `‹` / `›` scroll markers at `src/cli/components/TextInput.tsx:156` and `:160`. The bug is closed.

But the UX model is wrong for chat. The chat footer is the project's most-used human↔agent surface: it sits inside `agentDriver.renderFooter` at `src/cli/lib/interactions/drivers/agent.tsx:27-39` (the `<TextInput>` element spans lines 31-36), which is mounted whenever an `interactive-agent` block is live. Users compose multi-sentence prompts, paste file paths, splice code snippets, and **edit mid-text**. Every leftward arrow keypress re-anchors the visible window around the cursor's new position because of the 70% ratio — the entire visible text jumps under the cursor on every keystroke. The user note that anchors this illumination: *"the input is written only in one row instead that it would span to multiple rows like in the normal text areas. Also text in input area renders strangely if user want to modify already written text."*

The mental model the predecessor fix installed is a **browser address bar** (one row, scrolls under the cursor). The mental model the chat surface needs is a **textarea** (text wraps onto a second row, sits still while the cursor moves).

The reconciler bug that originally drove the sliding-window choice has a cleaner cure: render the buffer as N explicit rows inside a `<Box flexDirection="column">`. Ink then *knows* the component occupies N rows; the terminal does not hard-wrap; the row-count mismatch never exists.

### What this design closes

- "Text in input area renders strangely when I try to modify already written text" — the visible re-anchor glitch on every cursor move at `src/cli/components/TextInput.tsx:121-135`.
- "The input is written only in one row instead of spanning to multiple rows like a normal text area" — chat composition is multi-row by nature, and the rendering surface should match.

### What this design explicitly does **not** close

- `TextInput.tsx` itself. It stays untouched and remains the right component for short single-line prompts (placeholder cases, future prompt-style consumers). The sliding-window UX is appropriate where it lives.
- The `InteractionDriver` contract. `renderFooter` returns a component-agnostic `ReactNode` at `src/cli/lib/interactions/driver.ts:31`; the seam needs no widening.
- `GateSelector` / `SweepSelector`. They drive input via Ink's `useInput` hook directly (`src/cli/components/SweepSelector.tsx:23-54`), do not mount `TextInput`, and are not at risk.
- Multi-component wrapping libraries, soft word-boundary wrap, or paragraph reflow. The wrap is a hard width cap; word boundaries are out of scope.

## 2. Decision summary

One new component, one driver edit, one new test file.

1. **Add `src/cli/components/MultilineTextInput.tsx`** with the identical prop shape as `TextInput` at `src/cli/components/TextInput.tsx:4-15` (`value`, `onChange`, `onSubmit`, `disabled`, `placeholder`, `focus`, `prefixWidth?`). Internal state (`internal`, `cursor`), the `useInput` reducer, and the placeholder fast path are ported verbatim from `src/cli/components/TextInput.tsx:17-107`.

2. **Render the buffer as explicit rows.** Compute `wrapWidth = Math.max(10, (process.stdout.columns ?? 80) - prefixWidth)`. Split `internal` into `rows[i] = internal.slice(i * wrapWidth, (i + 1) * wrapWidth)`. Derive `cursorRow = Math.floor(cursor / wrapWidth)`; `cursorCol = cursor % wrapWidth`. Render one `<Text>` per row inside a `<Box flexDirection="column">`. On the cursor row, split at `cursorCol` and render `before` / inverse `cursorChar` / `after` exactly as `TextInput.tsx:154-162` does today, minus the `‹` / `›` markers.

3. **Drop the sliding-window apparatus** inside the new component: no `VIEW_CURSOR_RATIO`, no `viewStart` / `viewEnd`, no `budgetGross` / `budgetNet`, no `‹` / `›` markers, no marker re-anchor. The width cap is enforced by `wrapWidth`; Ink owns vertical layout.

4. **Swap the single production caller** at `src/cli/lib/interactions/drivers/agent.tsx:7,31`. Replace `import { TextInput } from "../../../components/TextInput.js"` (line 7) with `import { MultilineTextInput } from "../../../components/MultilineTextInput.js"`. Replace the `<TextInput` opener at line 31 with `<MultilineTextInput`. The `prefixWidth={2}` prop at line 32, the `"> "` gray prefix at line 30, and the surrounding `<Box>` are unchanged.

5. **Port `src/cli/tests/TextInput.test.tsx` to `src/cli/tests/MultilineTextInput.test.tsx`.** Keep the original six behavioural cases (`shows placeholder`, `appends printable`, `backspace deletes`, `Enter submits`, `disabled ignores`, `left/right arrows`) since the input reducer is the same. Replace the three sliding-window cases (clip-to-width, left marker, right marker) with two wrap-aware cases — see §3.5.

6. **Leave `TextInput.tsx` and its tests untouched.** No edit. Zero risk to any non-chat call site.

No `.dot` schema change, no driver-contract change, no ADR rewrite, no engine touch.

## 3. Architecture

### 3.1 Component shape

`MultilineTextInput` newly owns:

- Width-derived row splitting (`wrapWidth`, `rows[]`).
- Cursor coordinate derivation (`cursorRow`, `cursorCol`).
- A `<Box flexDirection="column">` body, one `<Text>` per row.

`MultilineTextInput` reuses verbatim from `TextInput`:

- `Props` shape and defaults (`src/cli/components/TextInput.tsx:4-25`).
- Internal state (`internal`, `cursor`) and the prop→state sync `useEffect` (`:29-36`).
- `internalRef` / `cursorRef` plumbing (`:39-42`).
- The full `useInput` reducer body (`:44-99`): `Enter` submits, `Backspace` deletes, `Left`/`Right` arrows move within bounds, `Ctrl-A` / `Ctrl-E` jump to home / end, printable input inserts at cursor. No behavioural change.
- Placeholder fast path (`:101-107`).

The caller responsibility is unchanged: declare how many columns are already burned on the row via `prefixWidth`. The caller does not measure the terminal or know about row splitting.

### 3.2 Row split algorithm

```
columns       = process.stdout.columns ?? 80
wrapWidth     = max(10, columns - prefixWidth)
# Treat the cursor's resting position past EOL as a virtual cell, so a
# buffer of length exactly k * wrapWidth still gets a tail row to host
# the inverse cursor block.
N             = internal.length
rowCount      = max(1, ceil((N + 1) / wrapWidth))
rows[i]       = internal.slice(i * wrapWidth, (i + 1) * wrapWidth)   # for i in 0..rowCount-1
cursorRow     = min(rowCount - 1, floor(cursor / wrapWidth))
cursorCol     = cursor - cursorRow * wrapWidth
```

Three invariants this preserves:

- **No row exceeds `wrapWidth` characters.** Ink renders each row inside its own `<Text>`; the terminal sees one logical row per visible row; no hard-wrap mismatch can occur.
- **Cursor is always inside a row.** `(N + 1)` budget guarantees a tail row exists when `cursor === N` and `N % wrapWidth === 0`.
- **No re-anchor on cursor move.** `wrapWidth` depends only on terminal width and `prefixWidth`; it never depends on `cursor`. Arrow-key navigation cannot shift `rows[]` content. Only the inverse-block cell changes position.

The `wrapWidth` floor of 10 mirrors the predecessor's `availableCols` floor at `src/cli/components/TextInput.tsx:116` and keeps narrow CI terminals (or vitest harnesses with `process.stdout.columns` unset) renderable.

### 3.3 Render shape

After the algorithm runs, the body is (pseudo-JSX):

```tsx
<Box flexDirection="column">
  {rows.map((row, i) => {
    if (i !== cursorRow) {
      return <Text key={i}>{row}</Text>;
    }
    const before = row.slice(0, cursorCol);
    const cursorChar = row.slice(cursorCol, cursorCol + 1) || " ";
    const after = row.slice(cursorCol + 1);
    return (
      <Text key={i}>
        {before}
        <Text inverse>{cursorChar}</Text>
        {after}
      </Text>
    );
  })}
</Box>
```

The inverse-cell rendering matches the predecessor's three-segment shape at `src/cli/components/TextInput.tsx:154-162`: `before` plain, `at` inverse, `after` plain — guaranteeing existing ink-testing-library assertions of the form `expect(lastFrame()).toContain("hello")` continue to read the visible characters.

The multi-row `<Box flexDirection="column">` pattern is already proven in the codebase at `src/cli/components/SweepSelector.tsx:77-91` (one `<Text>` per entry inside a column box) and at `src/cli/components/SweepSelector.tsx:62-73` (column box with mixed `<Text>` children). No new Ink idiom is introduced.

### 3.4 Caller change

At `src/cli/lib/interactions/drivers/agent.tsx:7`:

Before:
```ts
import { TextInput } from "../../../components/TextInput.js";
```

After:
```ts
import { MultilineTextInput } from "../../../components/MultilineTextInput.js";
```

At `src/cli/lib/interactions/drivers/agent.tsx:27-39`, the JSX body changes only the component identifier (the `<TextInput` opener at line 31 becomes `<MultilineTextInput`; the closing `/>` at line 36 is unchanged):

```tsx
renderFooter(block: LiveBlock, ctx: DriverRenderCtx) {
  return (
    <Box>
      <Text color="gray">{"> "}</Text>
      <MultilineTextInput
        prefixWidth={2}
        value={ctx.inputBuffer}
        onChange={ctx.onInputChange}
        onSubmit={ctx.onInputSubmit}
      />
    </Box>
  );
}
```

`prefixWidth={2}` (the `"> "` prefix is two columns) is unchanged. The surrounding `<Box>` stays a row box — the multi-row layout lives **inside** `MultilineTextInput`, so the gray `"> "` sits on the same line as the first row of input, and subsequent wrap rows sit beneath it. This matches the textarea analog the user approved in the explainer (the prefix is the "compose:" label; rows wrap underneath as input grows).

### 3.5 Test shape

New file `src/cli/tests/MultilineTextInput.test.tsx`, structured after `src/cli/tests/TextInput.test.tsx:1-141`:

1. **Ported behavioural cases (six):** `shows placeholder when value is empty`, `appends printable characters and moves cursor`, `backspace deletes the previous character`, `Enter calls onSubmit with current value`, `disabled ignores keystrokes`, `left/right arrows move the cursor within bounds`. All identical to `src/cli/tests/TextInput.test.tsx:32-75`; reducer behaviour is the same.
2. **Wraps long input into multiple rows:** render with `value = "a".repeat(wrapWidth + 5)`, assert `lastFrame()` splits to ≥ 2 lines and no line exceeds `wrapWidth` characters (stripped of ANSI per the `stripAnsi` helper in the predecessor test at `:80`). Compute `wrapWidth = max(10, (process.stdout.columns ?? 80) - prefixWidth)` to mirror the component.
3. **Mid-text edit does not shift row content:** render with a buffer that spans two rows, capture `lastFrame()`, then drive `\u001b[D` (left arrow) several times into row 0, capture `lastFrame()` again. Assert the non-cursor row's text content is byte-identical between the two frames (only the inverse cursor cell may move). This is the regression assertion for the "renders strangely when editing" symptom that motivated this design.

The three sliding-window assertions in `src/cli/tests/TextInput.test.tsx:84-140` (clip-to-width bound, left `‹` marker, right `›` marker) are intentionally **not** ported — `MultilineTextInput` has no sliding window and no markers.

`src/cli/tests/TextInput.test.tsx` stays unmodified. Its existing nine cases continue to pin the predecessor component for its single-line consumers.

## 4. Code anchors

- `src/cli/components/MultilineTextInput.tsx` — **new file**. Props mirror `src/cli/components/TextInput.tsx:4-15`. Reducer body ported from `:44-99`. Placeholder branch ported from `:101-107`. Render body per §3.3.
- `src/cli/components/TextInput.tsx` — **unchanged**. Remains the single-row component for short prompts.
- `src/cli/lib/interactions/drivers/agent.tsx:7` — import swap (`TextInput` → `MultilineTextInput`).
- `src/cli/lib/interactions/drivers/agent.tsx:27-39` — `renderFooter` JSX. Only the `<TextInput` opener at line 31 changes to `<MultilineTextInput`; `prefixWidth={2}` at line 32, the rest of the props, and the surrounding `<Box>` are unchanged.
- `src/cli/lib/interactions/driver.ts:21-31` — `DriverRenderCtx` and `InteractionDriver.renderFooter` contract; returns `ReactNode`, no edit required.
- `src/cli/tests/MultilineTextInput.test.tsx` — **new file**, structured per §3.5.
- `src/cli/tests/TextInput.test.tsx` — **unchanged**.
- `docs/adr/0014-interaction-drivers.md` — referenced for the driver seam; no edit required (no contract change).
- `docs/superpowers/specs/2026-05-14-textinput-terminal-wrap-causes-duplication-design.md` — predecessor; this design is the explainer-approved follow-up. Optional cross-link footnote, no edit required.

## 5. Blast radius / impact surface

- **Size:** S.
- **Surfaces crossed:** components (1 new) + drivers (1 edit) + tests (1 new file). No engine, no pipeline runtime, no agents, no daemon, no schema, no docs, no smoke fixtures.
- **Breaking change:** none. `MultilineTextInput` is additive. `agent.tsx` swaps the component the driver mounts internally; the driver's exported contract (`InteractionDriver<"interactive-agent">` at `src/cli/lib/interactions/driver.ts:27-37`) is unchanged. No public type changes signature. No existing test needs editing.
- **Files touched (1 source edit + 2 new):**
  - **New (2):** `src/cli/components/MultilineTextInput.tsx`, `src/cli/tests/MultilineTextInput.test.tsx`.
  - **Edit (1):** `src/cli/lib/interactions/drivers/agent.tsx` — line 7 (import) and line 31 (JSX element opener). Two-line diff.
  - **Untouched:** `src/cli/components/TextInput.tsx`, `src/cli/tests/TextInput.test.tsx`, `src/cli/lib/interactions/driver.ts`, all other drivers, every other test file.
- **Spec / docs ripple (all optional):**
  - [ ] `docs/adr/0014-interaction-drivers.md` — no contract change; optional addendum noting that `renderFooter` may return any `ReactNode` shape (already implied by the `ReactNode` return type at `src/cli/lib/interactions/driver.ts:31`). Recommend: skip.
  - [ ] `docs/superpowers/specs/2026-05-14-textinput-terminal-wrap-causes-duplication-design.md` — predecessor stays valid; optional one-line footnote linking forward. Recommend: skip; the originating-illumination header on this doc points the other direction.
  - [ ] `README.md` — no change. Chat-refinement surface is already documented; this is UX-parity work, not a new feature.
  - [ ] `CONTEXT.md` — no glossary addition. `MultilineTextInput` is component-local naming, not domain vocabulary.
- **Test ripple:** one new file. No existing test edited. ADR-0014's smoke scenario at `.apparat/scenarios/interaction-driver-escape/pipeline.dot` exercises the gate driver's Escape contract, not the agent driver's footer — unaffected.
- **Migration / data:** none. No on-disk format, no trace JSONL, no checkpoint.
- **Behaviour delta visible to users:** in `apparat implement` (and any pipeline mounting `interactive-agent`), the chat footer wraps onto new rows instead of sliding sideways; the `‹` / `›` scroll markers disappear from that surface; mid-text cursor moves no longer re-anchor the visible row.

## 6. Constraints

- **`TextInput.tsx` is invariant.** No edit. Its existing nine tests at `src/cli/tests/TextInput.test.tsx:32-140` continue to pass without modification. Any consumer that mounts `TextInput` directly keeps the sliding-window UX.
- **Reducer behaviour is invariant across components.** The `useInput` reducer at `src/cli/components/TextInput.tsx:44-99` is ported verbatim into `MultilineTextInput`. Submit on Enter, backspace deletes, arrows move within bounds, `Ctrl-A` / `Ctrl-E` jump, printable input inserts at cursor — all six behaviours are preserved. This is what lets the ported test cases pass unmodified.
- **`prefixWidth` semantics unchanged.** Same meaning as `src/cli/components/TextInput.tsx:11-14`: columns already consumed on the row by adjacent siblings. `MultilineTextInput` subtracts it from `process.stdout.columns` to derive `wrapWidth`. Defaults to `0`.
- **One terminal row per logical row.** `Box flexDirection="column"` with one `<Text>` per row makes Ink's row count match the terminal's row count by construction. This is the structural reason the reconciler-duplication bug cannot recur in this component.
- **Pure render.** `MultilineTextInput` does no I/O, no global state, no side-effecting effects beyond the existing `useEffect` that syncs `value` → `internal`. Snapshot-testable in isolation.
- **No new dependencies.** Uses only `react`, `ink`. Same imports as `TextInput`.

## 7. Open questions

1. **Should `MultilineTextInput` expose a `maxRows` prop to cap vertical growth?** Argument for: pasting a multi-page snippet could blow out the visible chat history. Argument against: YAGNI — no second caller, no real-world report of this pain, and the underlying terminal scroll already handles it. **Default: no `maxRows`; revisit only if a real operator complaint arrives.**
2. **Should the wrap honour word boundaries?** A hard character cap splits words mid-letter. Argument for: more readable. Argument against: word-aware wrap requires a tokeniser, has CJK / emoji edge cases, and the predecessor sliding-window had no word awareness either. **Default: hard character wrap; word-aware wrap is a separate UX surface.**
3. **Does the test for "mid-text edit does not shift row content" need a tmux harness component test?** The vitest assertion (compare two `lastFrame()` captures byte-by-byte on the non-cursor row) catches the regression in-process. A tmux harness exercise would confirm the terminal-level rendering matches. **Default: vitest assertion is sufficient at this stage; manual tmux exercise in §8 covers the integration smoke.**
4. **Should `TextInput.tsx` eventually consume `MultilineTextInput` internally with a `singleLine` mode?** Convergent rendering would reduce duplication. Argument against: the sliding-window UX is the right choice for short prompts and is settled; merging the two components conflates two distinct UX models. **Default: keep separate; the duplicated reducer body is a small price for clear-purpose components, and any future convergence can extract a shared `useTextInputReducer` hook.**

## 8. Verification targets

- **Unit tests:**
  - `npx vitest run src/cli/tests/MultilineTextInput.test.tsx` — eight cases (six ported + wrap + mid-edit invariance) all green.
  - `npx vitest run src/cli/tests/TextInput.test.tsx` — existing nine cases unchanged.
- **Type-check:** `npx tsc --noEmit`. Caller swap at `src/cli/lib/interactions/drivers/agent.tsx:6,33` must compile against the new component's props.
- **Manual tmux exercise** (per `memory/2026-04-17-ink-test-ansi-and-tmux-labels.md` harness convention):
  - `apparat implement <folder>` → enter the chat footer → paste a 200-character sentence. Expected: text wraps onto a second row, both rows visible simultaneously, no `‹` / `›` markers.
  - Same surface → arrow-left several times into row 0 → type a character. Expected: cursor moves visibly; non-cursor row content stays byte-identical (no jump under the cursor).
  - Same surface → grow the buffer past three rows. Expected: third row appears beneath, prior rows do not shift.
- **Driver-contract smoke:** `npx vitest run src/cli/tests/interaction-driver-escape-scenario.test.ts` — confirms the gate driver still satisfies the `InteractionDriver` contract; unaffected by this change but worth running as a sanity check that no shared seam regressed.
- **No new smoke fixtures.** No `.apparat/scenarios/*.dot` exercises the chat footer's rendering shape today; this slice is a TUI parity fix, not a new pipeline behaviour, so per the brainstorming skill's "do not expand scope" rule no scenario is added.
