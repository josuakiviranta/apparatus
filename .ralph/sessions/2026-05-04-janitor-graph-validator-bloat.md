---
date: 2026-05-04
run_id: 30a4a4d7-cf2f-4261-be29-fb7d2caddf9b
plan: docs/superpowers/plans/2026-05-04-janitor-graph-validator-bloat.md
design: docs/superpowers/specs/2026-05-04-janitor-graph-validator-bloat-design.md
illumination: meditations/illuminations/2026-05-01T0120-janitor-graph-validator-bloat.md
test_result: pass
---

# Janitor: graph-validator forward-adjacency + traversal-closure consolidation

## What was implemented

Single shared `buildForwardAdj(graph)` primitive replaces three drifted
inline adjacency builders inside the graph validator, and the three nested
closures inside `validateGraph` (`hasDefault`, `reachableWithout`,
`findQualifiedProducer`) collapse into a `GraphTraversal` deep module that
captures `adj` + `nodes` + `resolveHandlerType` once and exposes a narrow
`{hasDefault, reachable, findQualifiedProducer}` interface. Internal-only;
zero user-visible surface change.

## Key files

- M `src/attractor/core/dot-common.ts` — added `buildForwardAdj` export
- M `src/attractor/core/graph.ts` — routes through `buildForwardAdj`,
  introduces `createGraphTraversal` factory, replaces 3 nested closures
- M `src/attractor/core/flow-analyzer.ts` — `computeScope` now consumes
  `buildForwardAdj`
- M `src/attractor/tests/dot-common.test.ts` — 2 cases locking
  `buildForwardAdj` shape
- A `docs/superpowers/specs/2026-05-04-janitor-graph-validator-bloat-design.md`
- A `docs/superpowers/plans/2026-05-04-janitor-graph-validator-bloat.md`

## Decisions and patterns

- **Deep modules, not shallow SRP.** User redirected scope mid-session away
  from the original Finding 3 ("extract `checkVariableCoverage` as a 10th
  sibling") — audit of the existing nine `check*` siblings (avg 52 lines,
  uniform 3–4 param signatures) showed adding a 10th would replicate the
  shallow pattern. Variable_coverage block stayed inline.
- **Bundle, don't promote.** Naked module-level promotion of the three
  closures would have forced 5+ param signatures (mutual recursion +
  captured `adj` / `nodes` / `resolveHandlerType`) — exactly the shallowness
  the user wanted to avoid. Factory + closure-captured state hides BFS +
  producer-matching behind a smaller interface.
- **Rename `reachableWithout` → `reachable`.** Within the bundled interface
  the "without" parameter is no longer the interesting axis; clearer name.
- **Strict guard preserved (`adj.has(e.from) && adj.has(e.to)`).** Both
  pre-existing variants (lax: `adj.has(e.from)`; strict: `fwd.has(e.from)
  && fwd.has(e.to)`) drifted from one another — design §7.1 picked strict
  as the unified contract.
- **Atomic commit, not stacked.** Refactor + design doc landed as two
  commits (`259f2dd` code, `d29052c` docs) with no per-step churn.

## Gotchas and constraints

- Diagnostic strings at `graph.ts:301-314` are **byte-identical** before/
  after — any future edit there should preserve exact wording so the 17
  `variable_coverage` cases in `graph.test.ts` keep passing without
  modification.
- Public exports unchanged: `parseDot`, `resolveHandlerType`,
  `validateGraph`, `validateOrRaise`. 33 / 41 / 4 / 1 import sites
  respectively — do not break these signatures without a wider sweep.
- The three former closures had **zero external imports** at refactor
  time; if a future caller wants direct access, add it to the
  `GraphTraversal` interface rather than re-exposing nested functions.
- Reverse-adjacency consolidation was **deferred** (design §7.3) — only
  forward adjacency had a 3-way drift problem.
- ADR-0003's only `graph.ts` line citation targets `checkRequiredCallerVars`
  (`graph.ts:763-786`) — untouched by this refactor, so no ADR update
  needed.

## Learnings from the run

- `pipeline.jsonl` for `run_id=30a4a4d7-cf2f-4261-be29-fb7d2caddf9b` was
  **not present** under `~/.ralph/*/runs/30a4a4d7-cf2f-4261-be29-fb7d2caddf9b/`
  at memory-writer time (most recent traces in that tree end at run-ids
  `f6b021e5`, `0b5f987f`, `c1396746`). Memory file built from artifacts +
  git log only; per-node duration / retry data unavailable for this
  session.
- One transient parallel-suite flake during tmux-tester cycle 1
  (`pipeline-app-integration.test.tsx > chat → summarize full flow`,
  `expect(chatBlockMatch).not.toBeNull()` line 70). Cleared on isolated
  re-run (2/2) and full-suite cycle-2 re-run (1262/1262). Not in this
  diff's blast radius (graph.ts / flow-analyzer.ts / dot-common.ts touch
  no React or Ink). Likely React-18 batched-dispatch timing under
  parallel load — worth filing as a separate flake-hunt illumination if
  it recurs.

## Final verification

- test_result: pass
- test_summary: Cycle 1 surfaced 1 failing test
  (pipeline-app-integration.test.tsx) and 1262 passing; isolation re-run
  passed (2/2) and cycle 2 full-suite re-run passed clean (1262/1262) —
  confirmed parallel-suite flake unrelated to the validator-refactor diff
  (graph.ts/flow-analyzer.ts/dot-common.ts). Phase 3 validation of bundled
  pipelines (janitor, meditate, implement) all returned 'Pipeline valid'.
  No fixes applied.
