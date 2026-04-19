---
date: 2026-04-19
status: open
description: The pipeline engine sets a single global $choice after every gate, so back-to-back gates clobber each other's decisions — namespace per-gate as $<gateNodeId>.choice with $choice aliasing to most-recent.
---

## Core Idea

Hexagon gate nodes produce a context variable `choice` that holds the user's pick (e.g. `"Approve"`, `"Decline"`, `"Chat"`). Routing edges read it via `condition="choice=Approve"` (see `src/attractor/tests/graph.test.ts:491-531`). The variable is **global, not per-gate** — every gate write to `$choice` overwrites the previous gate's value.

Today this latent bug doesn't bite because no production pipeline reads `$choice` past the immediate routing edge. But `pipelines/illumination-to-implementation.dot` has three gates (`approval_gate`, `review_gate`, `tmux_confirm_gate`) and as soon as a downstream node tries to interpolate the earlier gate's choice — for audit trail, branching on prior decision, or memory-writer context — the value is already overwritten.

The fix is engine-side: write `$<gateNodeId>.choice` after every gate. Keep `$choice` as a sugared alias resolving to the most recently written gate's choice (backward compatible).

## Why It Matters

Gates are the **only place pipelines capture human intent**. Losing that intent across gates means:

- **No audit trail.** `memory_writer` cannot record "user approved at review_gate then chose Tmux at next gate" — only the last gate's choice survives.
- **No conditional re-render.** A future explainer that wanted to show "you previously declined this — here's the refined plan" cannot reference the prior choice.
- **Hidden footgun.** A pipeline author writing `condition="choice=Approve"` six edges downstream of the originating gate gets silently wrong routing, with no validate-time error. The sharp edge is invisible.

The cost of fixing it now is one engine change + a backward-compatible alias. The cost of not fixing it is every future multi-gate pipeline carries the same trap.

## Revised Implementation Steps

1. **Update gate handler in `src/attractor/core/engine.ts` (or wherever gate `wait-human` resolution writes context).** When a gate's `onChoose(choice)` fires, write to two keys: `<gateNodeId>.choice = <pick>` AND `choice = <pick>` (alias for backward compat). The dotted key requires no schema change — context is a flat key→value bag, and `.` is a legal character in keys.

2. **Update condition parser in `src/attractor/core/graph.ts` (or wherever `condition="key=value"` is evaluated).** Confirm dotted keys work end-to-end. Add a unit test asserting `condition="approval_gate.choice=Approve"` correctly routes when the gate named `approval_gate` resolved to `"Approve"`. The bare `choice=` alias must continue routing on the most-recent gate's pick.

3. **Add a regression test in `src/attractor/tests/graph.test.ts` covering the clobber scenario.** Two sequential gates `g1` and `g2`; g1 picks `"a"`, g2 picks `"b"`. Assert `$g1.choice === "a"` after g2 resolves (i.e. NOT clobbered). Today this would fail; after the fix it passes. Then assert `$choice === "b"` (alias still tracks most recent).

4. **Document the namespacing in `specs/architecture.md` (or the gate spec).** One-paragraph note explaining: every gate writes `<gateNodeId>.choice`; bare `$choice` is sugar for the most recent. Include the rationale (multi-gate pipelines need to reference prior decisions).

5. **No pipeline migrations required.** Existing `.dot` files using `condition="choice=..."` keep working via the alias. New pipelines that need cross-gate choice access opt into the explicit `<gateNodeId>.choice` form.
