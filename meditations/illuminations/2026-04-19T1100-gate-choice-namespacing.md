---
date: 2026-04-19
status: resolved
description: The pipeline engine sets a single global $choice after every gate, so back-to-back gates clobber each other's decisions AND validate emits a false-positive "no known producer" warning for every gate-consumed $choice because producers are implicit — namespace per-gate as $<gateNodeId>.choice with $choice aliasing to most-recent, and declare the produces link so validate stops whining.
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

## Validator symptom (concrete evidence)

Running `pipeline validate` on the current illumination-to-implementation pipeline emits:

```
$ bun run ./dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot
⚠ [variable_coverage] Variable "$choice" referenced by node "mark_archived" has
 no known producer
✔ Pipeline valid (20 nodes, 28 edges)
```

The warning is **a false positive**: at runtime both `remove_gate` and `approval_gate` are upstream of `mark_archived` and both set `$choice` before `mark_archived` runs. But the validator walks the static graph looking for `produces="choice"` on upstream nodes and finds none — because gates write `$choice` **invisibly through the engine**, not through a declared `produces=` attribute.

The relevant sites:

- `pipelines/illumination-to-implementation.dot:14-17` — `mark_archived` reads `$choice` via `script_args="$illumination_path $choice"`.
- `pipelines/illumination-to-implementation.dot:12` — `remove_gate [shape=hexagon, label="..."]` has no `produces=`.
- `pipelines/illumination-to-implementation.dot:26` — `approval_gate [shape=hexagon, label="..."]` has no `produces=`.
- Engine-side producer: the gate resolution code (path TBD during fix work — start at the `wait-human` handler and the `pipeline validate` variable-coverage walker) writes `$choice` without telling the static graph.

**Why this is a real problem, not just noise:**

- Every pipeline author who uses a gate + downstream consumer sees this warning and has to learn "oh that's normal, ignore it". That corrodes the validator's signal: the next real missing-producer bug hides behind the noise.
- The warning is currently the ONLY blemish on an otherwise-clean pipeline validate. Once it's gone, `validate` is a pure pass/fail signal again.

The namespacing fix below fixes both symptoms with one engine change: if gates emit `<gateNodeId>.choice` and the engine declares that producer link so the static graph sees it (either by synthesizing `produces="<gateNodeId>.choice"` on every gate at load time, or by teaching the variable-coverage walker to trust gate nodes as implicit producers of their `choice`), the validator stops warning AND the runtime stops clobbering.

## Revised Implementation Steps

1. **Update gate handler in `src/attractor/core/engine.ts` (or wherever gate `wait-human` resolution writes context).** When a gate's `onChoose(choice)` fires, write to two keys: `<gateNodeId>.choice = <pick>` AND `choice = <pick>` (alias for backward compat). The dotted key requires no schema change — context is a flat key→value bag, and `.` is a legal character in keys.

2. **Update condition parser in `src/attractor/core/graph.ts` (or wherever `condition="key=value"` is evaluated).** Confirm dotted keys work end-to-end. Add a unit test asserting `condition="approval_gate.choice=Approve"` correctly routes when the gate named `approval_gate` resolved to `"Approve"`. The bare `choice=` alias must continue routing on the most-recent gate's pick.

3. **Add a regression test in `src/attractor/tests/graph.test.ts` covering the clobber scenario.** Two sequential gates `g1` and `g2`; g1 picks `"a"`, g2 picks `"b"`. Assert `$g1.choice === "a"` after g2 resolves (i.e. NOT clobbered). Today this would fail; after the fix it passes. Then assert `$choice === "b"` (alias still tracks most recent).

4. **Teach the `pipeline validate` variable-coverage walker that gates produce `<gateNodeId>.choice` and `choice`.** Pick the implementation approach that best fits the existing validator code:
   - **Option A — synthesize produces at load time.** When the loader encounters a `shape=hexagon` node, synthesize `produces="<gateNodeId>.choice, choice"` on it in the in-memory graph. Variable-coverage walker then finds the producer without special-casing.
   - **Option B — special-case gates in the walker.** The walker keeps its existing produces-only logic but treats gate nodes as implicit producers of `choice` + `<gateNodeId>.choice` when resolving `$choice` references downstream.
   Prefer Option A — fewer special cases downstream, and any future validator that walks the graph (e.g. unused-producer checks) gets the declaration for free. Regression: re-running `pipeline validate pipelines/illumination-to-implementation.dot` after the fix must pass without the `[variable_coverage] Variable "$choice" referenced by node "mark_archived" has no known producer` warning.

5. **Document the namespacing in `specs/architecture.md` (or the gate spec).** One-paragraph note explaining: every gate writes `<gateNodeId>.choice`; bare `$choice` is sugar for the most recent. Include the rationale (multi-gate pipelines need to reference prior decisions) and the validator contract (gates declare `choice` as an implicit produces).

6. **No pipeline migrations required.** Existing `.dot` files using `condition="choice=..."` keep working via the alias. New pipelines that need cross-gate choice access opt into the explicit `<gateNodeId>.choice` form.

## Resolution

- Steps 1-3, 5, 6: shipped in commit 8cb4eef (runtime write) + af80f89 (docs).
- Step 4 (validator producer declaration): shipped per `specs/2026-04-19-gate-validator-producer-declaration-design.md`. Extended `TYPE_PRODUCES["wait.human"]` with `"choice"` and added per-node `<id>.choice` augmentation in `validateGraph` (`src/attractor/core/graph.ts`). Three regression tests cover clean / skip-path / no-upstream-gate branches.

`pipeline validate pipelines/illumination-to-implementation.dot` is now a clean pass.
