---
date: 2026-05-11
description: Every TUI interaction kind (interactive-agent, gate, wait-human) bolts optional fields onto a single LiveBlock god-type and forces edits in 5 places (NodeEvent union, reducer, LiveBlock optionals, PipelineApp emit branch, LiveFooter render branch) — collapse them into per-kind driver modules with one register() seam, and the missing Escape cancel falls out of the same refactor.
---

## Core Idea

`LiveBlock` is a shallow god-type. It carries optional `child`, `onDone`, `gate.options`, `gate.onChoose`, plus a `kind` discriminator that the compiler doesn't actually enforce. Each interaction kind (`interactive-agent`, `wait-human`, gate-bearing) is spread across five files instead of being one deep module: a `NodeEvent` variant, a reducer case, optional fields on `LiveBlock`, an emit branch in `PipelineApp.tsx`, and a render branch in `LiveFooter.tsx`. The user-visible symptom is that escape vocabularies and "what can I do here" hints are invented per kind — agent input has `/end /abort /help`, gate has digits/arrows with no Escape, wait-human inherits gate's shape silently.

## Why It Matters

Pipeline ergonomics for the end user start at the live footer. Right now the footer is the surface where every shallow module pile-up lands at once:

- `src/cli/lib/pipelineEvents.ts` — `LiveBlock` accretes `child?`, `onDone?`, `gate?` as optional fields. Adding a fourth interaction kind (e.g. "approve diff" or "pick file") means another optional, another reducer event, another emit branch.
- `src/cli/lib/pipelineReducer.ts` — `interactive-ready` and `gate-ready` are sibling cases that both write to `state.live`, but the rest of the reducer can't see what kind of live block it has; each new "ready" event needs its own case.
- `src/cli/components/LiveFooter.tsx` — renders gate, status line, and TextInput by reading optional fields and `block.kind`. Discoverability text ("↑↓ navigate · Enter or 1-N to choose") lives only in `GateSelector`; `TextInput` shows none; wait-human shows none.
- `src/cli/components/GateSelector.tsx:11-19` — handles arrows/digits/Enter but no `key.escape` exit. The "every action needs an escape" rule is violated structurally, not by accident — there is no place where cancel semantics for *all* kinds are declared.
- `src/cli/components/PipelineApp.tsx` — the emit lambda branches per event kind to append static items. Each kind has its own ID prefix convention. Adding a kind here means more closure-captured refs (`liveBlockIdRef`, `liveBodyCountRef`, `traceAppendedRef`).

This is the deep-module test from the stimulus: where is one concept implemented twice (or five times) with no single seam forcing them to agree? Here. The compiler doesn't catch a missing `LiveFooter` branch for a new kind. The reducer doesn't catch a missing escape handler. Drift is silent.

Three illuminations already cover adjacent symptoms (mission-control fragmentation, useInput-router chaos, pipeline-run shims). This one is the *data-shape* sibling of the useInput-router illumination — the router lives in the keyboard layer; this lives in the state/render layer. Both need to land before adding a fourth interaction kind is sane.

## Revised Implementation Steps

1. Define `InteractionDriver<K>` in `src/cli/lib/interactions/driver.ts` — interface with `{ kind: BlockKind; initState(event): KindState; reducerCases: Record<EventKind, Reducer>; renderFooter(state, ctx): JSX; keymap: { escape: () => void; ...}; }`. Tiny interface, all per-kind complexity hidden behind it.

2. Extract `interactive-agent` driver (`drivers/agent.ts`) — owns `child`, `onDone`, slash-command parsing, `TextInput` mounting, and Escape → abort. Drop `child`/`onDone` off `LiveBlock`; keep them inside driver state keyed by `block.id`.

3. Extract `gate` driver (`drivers/gate.ts`) — owns options/choice, arrow+digit keymap, **and a working `key.escape` that emits an `abort` outcome**. This is the immediate ergonomic win: `Esc` finally cancels a gate.

4. Replace the reducer's `interactive-ready` / `gate-ready` cases with a single generic `driver-event` case that delegates to `drivers[live.kind].reduce(event, state)`. `LiveBlock` shrinks to `{id, nodeId, label, kind, startedAt, body, stats, tracePath}` — no optionals.

5. Rewrite `LiveFooter` to one body: `{drivers[block.kind].renderFooter(block)}` plus the shared status line. Delete the per-kind branches. Add a shared "press `?` for help" hint pulled from `driver.keymap.help` so every kind shows its keys the same way.

6. Add `templates/scenarios/interaction-driver-escape/pipeline.dot` smoke test — assert that `Esc` on a gate node ends the pipeline with `abort` outcome and that an interactive-agent node responds to `Esc` the same way. This freezes the escape contract for any future driver.

7. Document the contract in `docs/adr/0014-interaction-drivers.md` — single seam, single escape vocabulary, single registration site. Future "approve diff" or "pick file" kinds add one driver file; nothing else moves.
