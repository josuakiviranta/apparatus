---
date: 2026-05-14
description: TextInput renders with no terminal-width constraint — when input exceeds the column width, Ink's single-row assumption breaks and causes visual duplication on every keystroke.
---

## Core Idea

`TextInput` (`src/cli/components/TextInput.tsx`) renders the full buffer as three consecutive `<Text>` segments with no width limit. When the total character count exceeds the terminal column width, the terminal hard-wraps the line onto a second row. Ink's reconciler does not know about the wrap — it assumes the input occupies exactly one row. On the next keystroke, Ink moves the cursor up one row and overwrites, leaving the second wrapped row untouched. The leftover row is what users see as "duplication with every new key stroke." The arrow-key confusion is a secondary symptom of the same root cause: the visible cursor highlight lands in the wrong visual position relative to the wrapped rows.

The user note anchoring this session: *"When inputting text in the interactive chat, the inputted text behaves strangely if user tries to go back with arrow keys to modify the earlier already written message in input area. Also often when the input text hits the sides of input area certain way the output in terminal starts to dublicate with every new key stroke."*

## Why It Matters

This is the primary interactive surface of the apparatus chat UX — the `> ` input line rendered by `agentDriver.renderFooter` in `src/cli/lib/interactions/drivers/agent.tsx`. Any user who types more than ~78 characters hits this bug. It makes the chat session visually broken and degrades trust in the tool at exactly the moment when long, nuanced messages to an agent matter most.

The fix is well-understood and contained. It does not require changes to Ink or the parent component tree — only `TextInput.tsx` needs to change.

## Revised Implementation Steps

1. **Accept a `prefixWidth` prop (default `0`) on `TextInput`** — the caller (`agentDriver.renderFooter`) passes `2` for the `"> "` prefix, so the input knows how much horizontal space is already consumed on the row.

2. **Compute `availableCols` inside `TextInput`** — `Math.max(10, (process.stdout.columns ?? 80) - prefixWidth - 1)`. The `- 1` reserves one column for the block cursor at EOL.

3. **Derive a sliding view window** — given `cursor` and `availableCols`, compute `viewStart = Math.max(0, cursor - Math.floor(availableCols * 0.7))` and `viewEnd = viewStart + availableCols`. Clamp `viewEnd` to `internal.length + 1`. Slice `before`, `at`, `after` from within `[viewStart, viewEnd)`.

4. **Add left/right scroll indicators** — render a dim `‹` when `viewStart > 0` and a dim `›` when `viewEnd < internal.length + 1`. Each indicator consumes one column; subtract from `availableCols` when present.

5. **Add a test in `TextInput.test.tsx`** — render with a very long initial string (`"a".repeat(200)`) and a narrow explicit `prefixWidth`. Assert that `lastFrame()` length (stripped of ANSI) is at most `availableCols + prefixWidth`. Assert the cursor character (inverse block) is visible in the output. This exercises the clipping path and guards against regression.

6. **Update `agentDriver.renderFooter`** to pass `prefixWidth={2}` (the `"> "` is 2 chars). No other callers exist today.
