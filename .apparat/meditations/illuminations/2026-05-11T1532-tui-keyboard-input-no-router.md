---
date: 2026-05-11
description: Three Ink components (PipelineApp, GateSelector, TextInput) each register their own useInput hook with no focus arbiter — so when a node opens both an interactive input and a gate, every digit double-dispatches; the same shallow-module pattern shows up in input-buffer state (one user string tracked in five places) and in the dead BlockView component still drifting alongside PipelineApp's inline renderer.
---

## Core Idea

The TUI has no keyboard router. Three independent `useInput` hooks coexist — `PipelineApp.tsx:96` (SIGINT re-raise), `GateSelector.tsx:11` (arrows + digits + return), `TextInput.tsx:39` (typing + arrows + ctrl-a/e). Ink broadcasts every keystroke to all active hooks, so when `LiveFooter.tsx:39-66` mounts a gate AND a TextInput simultaneously, "1" both inserts a literal "1" in the buffer AND selects gate option 1. The same fragmentation shows up in input-buffer state: one user string is tracked in five places (`PipelineApp.inputBuffer`, `TextInput.internal`, `internal*Ref*`, `cursor`, `cursor*Ref*`), reconciled via a `useEffect([value])` sync — the textbook recipe for stale-closure races. Both fail the deep-modules lens: `TextInput`'s 3-prop interface hides almost no implementation, and the keyboard substrate has no single seam.

## Why It Matters

Steer asks for TUI input correctness and cognitive ease. Today the input substrate is a collection of shallow surfaces with hidden contention.

**1. Latent gate/input collision.** `GateSelector.tsx:11-19` calls `useInput` with **no `isActive` guard** — always-on while mounted. `TextInput.tsx:39-89` is gated by `focus && !disabled` (default true). `LiveFooter.tsx` renders both blocks unconditionally when `block.gate` is set on an `interactive-agent` node:

```tsx
{block.gate && <GateSelector ...>}
{block.kind === "interactive-agent" && <Box>...<TextInput .../></Box>}
```

Any pipeline pattern where a gate appears mid-conversation (e.g. inline review prompts on a chat-style node) will double-dispatch every digit. There is no test covering "interactive + gate active simultaneously" — the existing `PipelineApp.test.tsx` cases drive each in isolation. The bug is one pipeline-author edit away.

**2. Triple-bookkeeping of one string.** `TextInput.tsx:21-22` keeps `useState(value)` for `internal` and `cursor`; `:30-33` keeps `internalRef`/`cursorRef` so the `useInput` closure sees latest values; `:25-28` syncs the prop back into internal on every prop change; `:55,75,84` calls `onChange` to push internal back out. The parent (`PipelineApp.tsx:51`) keeps `inputBuffer` in its own `useState`, then clears it inside `onSubmit`. Five state slots, one string, two-way wiring. The comment at `:18-20` explicitly says this exists because "ink-testing-library delivers stdin synchronously" — but that's just papering over the fact that `value` is owned twice. Any future feature (paste, multiline, IME, history) lands on top of this hairball.

**3. Dead parallel renderer.** `BlockView.tsx:55-64` defines a `BlockView` component that renders a frozen block. Nothing in `src/` imports it — `PipelineApp.tsx:171-203` re-implements the same rendering inline as `<Static>` switch arms (`block-open`, `trace-line`, `body-line`, `block-close`). Only `BodyLineView` from the same file is still used. `BlockView.test.tsx` keeps the dead component alive. This is exactly the deep-modules anti-pattern: "a concept implemented twice with no single seam where they're forced to agree." Drift is a matter of time.

**4. LiveFooter elapsed-time tick is a 100 ms repaint.** `LiveFooter.tsx:42-45` runs `setInterval(tick, 100)` purely to repaint a `(ms/1000).toFixed(1)` value. Re-renders the gate + input + status line 10×/sec even when nothing changed. Cheap with one block; compounds visibly when paired with the input-state churn above and produces the "input feels mushy" symptom.

The strategic compass (vision: solo dev, many projects, many agents, *don't re-orient every session*) is undermined every time a keystroke does the wrong thing. Input correctness is a precondition for cognitive ease, not a polish item.

## Revised Implementation Steps

1. **Add `focus` to `LiveBlock` (or derive from `gate` + `child` presence).** One field in `pipelineEvents.ts`: `focus: "gate" | "input" | "idle"`. Mutually exclusive by construction — the reducer enforces "gate beats input while open." This is the new seam.

2. **Collapse to one `useInput` in `PipelineApp.tsx`.** It dispatches by `state.live?.focus`: digits + arrows + return route to gate when `focus="gate"`; chars + arrows + backspace + ctrl-a/e route to text input when `focus="input"`; SIGINT always. `GateSelector` and `TextInput` lose their `useInput` calls and become pure render functions.

3. **Make `TextInput` controlled and stateless.** Props become `{ value, cursor }`. Delete `internal`, `internalRef`, `cursor`, `cursorRef`, the `useEffect([value])` sync. The reducer in `pipelineReducer.ts` owns buffer + cursor as part of `state.live.input`. `PipelineApp.inputBuffer` `useState` goes away with it.

4. **Add a regression test in `PipelineApp.test.tsx`** that mounts an interactive node, fires `gate-ready` mid-stream, types "1", and asserts the buffer reads "1" while no gate option was chosen (or the inverse, depending on the focus rule). This pins the new contract.

5. **Delete `BlockView` (the component) from `src/cli/components/BlockView.tsx`.** Keep `BodyLineView` — it's the still-referenced symbol. Delete `BlockView.test.tsx` along with it. Removes the parallel-implementation drift surface and saves a future maintainer from "wait, which renders the closing block?" archaeology.

6. **Throttle the `LiveFooter` tick to 1 Hz** (or move elapsed-time off the React render path entirely — render the static `startedAt`, let the user infer freshness from the streaming feed). 100 ms repaint earns nothing.

7. **CONTEXT.md gains a "Keyboard input" subsection** under the runtime/UI domain, naming the router seam and the focus-state field. The current glossary has no UI vocabulary — the next agent touching the TUI rediscovers all of this from scratch.
