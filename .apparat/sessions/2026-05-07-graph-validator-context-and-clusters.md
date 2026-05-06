---
date: 2026-05-07
run_id: 83c137b6
plan: docs/superpowers/plans/2026-05-06-graph-validator-context-and-clusters.md
design: docs/superpowers/specs/2026-05-06-graph-validator-context-and-clusters-design.md
illumination: .apparat/meditations/illuminations/2026-05-06T2211-graph-validator-context-and-clusters.md
test_result: pass
---

# graph-validator context and clusters

## What was implemented
`src/attractor/core/graph-validator.ts` no longer holds 1,156 lines of inline rules + 11 differently-shaped helpers. Every rule now consumes a single `ValidationContext` bundle (`graph, dotDir, nodeProduces, traversal, callerInputs, diags`) and rules are clustered into `src/attractor/core/validators/{flow,types,scripts,variables,gates,interactive,inputs-refs,index}.ts`. Public API (`validateGraph`, `validateOrRaise`, `Diagnostic` shape, all `Diagnostic.rule` strings) stays byte-identical — pinned by the existing oracle test.

## Key files
- A `src/attractor/core/validators/flow.ts` (Chunk 2.1)
- A `src/attractor/core/validators/types.ts` (Chunk 2.2)
- A `src/attractor/core/validators/scripts.ts` (Chunk 2.3)
- A `src/attractor/core/validators/variables.ts` (Chunk 2.4)
- A `src/attractor/core/validators/gates.ts` (Chunk 3.1)
- A `src/attractor/core/validators/interactive.ts` (Chunk 3.2)
- A `src/attractor/core/validators/inputs-refs.ts` (Chunk 3.3)
- A `src/attractor/core/validators/index.ts` (`runAllValidators` orchestrator, Chunk 3.5)
- A `docs/adr/0012-validation-context.md` (ADR-0012)
- M `src/attractor/core/graph-validator.ts` (Chunk 1 ctx scaffold → progressively gutted → Chunk 3.6 façade over `runAllValidators`)
- M `docs/superpowers/plans/2026-05-06-graph-validator-context-and-clusters.md` (per-task checkbox ticks + reviewer notes)

## Decisions and patterns
- **Context scaffold first, then incremental cluster lifts.** Chunk 1 added the `ValidationContext` bundle and rewired `graph-validator.ts` to consume its own ctx before any rule moved out. Each Chunk 2/3 sub-task was one cluster extraction + one plan-checkbox commit, so each refactor step was independently bisectable.
- **Façade kept the public surface frozen.** Final `graph-validator.ts` is a thin wrapper (`refactor(attractor/core): graph-validator becomes a façade over runAllValidators` — 7234777). ADR-0009's frozen contract held end-to-end; the byte-identical oracle test never needed editing.
- **Shared helper preceded gates extraction.** `feat(attractor/validators): add shared tryResolveAgent helper` (ab9c3e0) landed *before* `validators/gates.ts` (d4489cc) so gates and later clusters share one resolver path instead of duplicating it.
- **runEarly / runLate split documented.** `c45df47` annotated the orchestrator's two-pass ordering (variable-coverage rules read state populated by earlier clusters) so future cluster authors know where to slot a new rule.
- **ADR-0012 was the closing artifact**, not a kickoff doc — written after the refactor stabilized so it reflects what shipped, not what was planned.

## Gotchas and constraints
- Public API is **frozen by ADR-0009** — `validateGraph`, `validateOrRaise`, `Diagnostic` signature, every `Diagnostic.rule` string. The byte-identical oracle test (`src/attractor/tests/graph-validator-byte-identical.test.ts`) will fail loudly if a rule string drifts. Don't rename rules during cluster moves.
- `runEarly` populates state (e.g. `nodeProduces`) consumed by `runLate`. New rules must declare which pass they need; landing a producer-aware rule in `runEarly` will silently see an empty map.
- Cluster extractions left a few **unused-import / unused-destructure trail-fixes** behind (`8c0db37`, `15f8d60`, `83b0181`, `fad80cd`) — TS strict catches these, but it's the predictable shape of incremental lifts.
- `tmux-tester` skipped the agent/chat scenarios because they spawn live Claude sessions; the green `pipeline-smoke-*-folder.test.ts` files cover the same ground in vitest. Don't read the skip as a coverage gap.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build + 1306 vitest tests across 146 files passed; all 14 scenario pipelines validated; 4 Claude-free scenarios driven live in tmux (store, tool, tool-runtime-vars, missing-caller-var) all behaved as expected; agent/chat scenarios skipped per the no-Claude-session rule but covered by green pipeline-smoke vitest files. No fixes required.
