---
date: 2026-05-16
description: The sliding-window TextInput fix resolved Ink reconciler duplication but installed the wrong UX model — address-bar scrolling where users expect textarea wrapping — and the cursor re-anchoring logic causes visible glitches during mid-text edits.
---

## Core Idea

The TextInput fix implemented from the `2026-05-14T1525` illumination solved Ink's reconciler confusion (terminal wrapping → invisible second row → duplication on every keystroke) by replacing unconstrained rendering with a sliding single-row window. It worked. But it chose the wrong UX metaphor. The user note anchoring this session: *"the input is written only in one row instead that it would span to multiple rows like in the normal text areas. Also text in input area renders strangely if user want to modify already written text."*

The root of the "renders strangely" symptom is `VIEW_CURSOR_RATIO = 0.7`: every cursor move re-anchors the visible window around the cursor's new position, causing the entire visible text to shift left or right. For a user navigating left to fix a typo, the text visually jumps under their cursor on every arrow keypress — a disorienting experience that makes precise editing nearly impossible.

The correct fix is explicit multi-row rendering: split the text buffer into width-capped rows and render each as a separate `<Text>` inside a `<Box flexDirection="column">`. Ink then *knows* the component occupies N rows and reconciles correctly. The original bug was that Ink thought the component was 1 row but the terminal hard-wrapped it to 2 — explicit rows eliminate the mismatch without sacrificing multi-row behavior.

## Why It Matters

`agentDriver.renderFooter` in `src/cli/lib/interactions/drivers/agent.tsx` is the primary human↔agent interface. Chat inputs are long: multi-sentence instructions, file paths, code snippets. The sliding-window model was designed for URL bars where users type-then-submit and rarely edit mid-text. Chat users compose, review, and correct. Every mid-text cursor move currently triggers a jarring re-anchor. The interaction pattern and the UX model are mismatched at the most-used surface in the tool.

`TextInput.tsx` already passes the `prefixWidth` prop and reads `process.stdout.columns` — the infrastructure for width-aware rendering is in place. The only thing that needs changing is the rendering strategy.

## Revised Implementation Steps

1. **Create `MultilineTextInput.tsx`** in `src/cli/components/`. Interface stays identical to `TextInput`: `value`, `onChange`, `onSubmit`, `disabled`, `placeholder`, `focus`, `prefixWidth`. No call-site changes needed except the import path at `agentDriver.renderFooter`.

2. **Compute wrap width inside the component**: `const wrapWidth = Math.max(10, (process.stdout.columns ?? 80) - prefixWidth)`. Split `internal` into visual rows: `rows[i] = internal.slice(i * wrapWidth, (i + 1) * wrapWidth)`. Number of rows = `Math.ceil((internal.length + 1) / wrapWidth)` (the `+1` accounts for cursor EOL cell).

3. **Derive cursor position** from flat `cursor` index: `cursorRow = Math.floor(cursor / wrapWidth)`, `cursorCol = cursor % wrapWidth`. Render each `rows[i]` as a `<Text>` in a `<Box flexDirection="column">`. On the cursor row, split at `cursorCol`: render `before` normally, `cursorChar` with `inverse`, `after` normally — identical to the current per-row rendering logic.

4. **Remove the sliding-window logic entirely** — `viewStart`, `viewEnd`, `VIEW_CURSOR_RATIO`, scroll indicators (`‹`/`›`), and `budgetGross`/`budgetNet`. All of it goes away. The width cap is enforced by `wrapWidth`; Ink handles vertical layout. The component becomes simpler than the current one.

5. **Port `TextInput.test.tsx` to `MultilineTextInput.test.tsx`**. Add a wrapping assertion: `"a".repeat(wrapWidth + 5)` should produce two lines in `lastFrame()` with no line exceeding `wrapWidth` characters (stripped of ANSI). Add a mid-text edit test: navigate left with arrows into row 0 while text spans two rows, then type a character — assert the character appears at the correct position and no line exceeds `wrapWidth`.

6. **Replace `TextInput` with `MultilineTextInput`** only in `agentDriver.renderFooter`. Keep `TextInput` for `GateSelector`, `SweepSelector`, and any other single-line prompts — those contexts are short and the single-row model is fine. Rename the export if needed to make the distinction explicit.
