---
date: 2026-05-05
run_id: 433e874d-f17e-481a-856a-e41528db930a
plan: docs/superpowers/plans/2026-05-05-shallow-control-flow-handlers.md
design: docs/superpowers/specs/2026-05-05-shallow-control-flow-handlers-design.md
illumination: meditations/illuminations/2026-05-05T1030-shallow-control-flow-handlers.md
test_result: pass
---

# shallow-control-flow-handlers

## What was implemented
Deleted the no-op `ConditionalHandler` and the JSON-codec `ParallelHandler`/`FanInHandler` from `src/attractor/handlers/`. Conditional dispatch is now a one-line inline passthrough in `engine.ts` (sibling to the existing `isExitNode` shape-marker check); `selectNextEdge` already owned the real edge-selection logic. Parallel/fan-in support was never end-to-end implemented — `UNIMPLEMENTED_TYPES` already rejected those graphs in validation, so the runtime classes were pure dead code.

## Key files
- `src/attractor/handlers/conditional.ts` — deleted
- `src/attractor/handlers/parallel.ts` — deleted
- `src/attractor/core/engine.ts` — inline conditional passthrough at dispatch site
- `src/attractor/core/graph.ts` — drop `parallel`, `parallel.fan_in` from `KNOWN_TYPES` / `UNIMPLEMENTED_TYPES`; drop `component` / `tripleoctagon` shape mappings; `diamond → conditional` retained
- `src/attractor/handlers/registry.ts` — drop `branchOutcomes` field from `HandlerExecutionContext`
- `src/attractor/types.ts` — narrow `OutcomeStatus` to `"success" | "retry" | "fail"` (drop `partial_success`)
- `src/cli/commands/pipeline.ts` — remove sole non-test `partial_success` consumer in renderer
- `src/attractor/tests/handlers.test.ts` — delete `ConditionalHandler` + parallel `describe` blocks
- `src/attractor/tests/engine.test.ts` — add focused engine-level test pinning the inline conditional passthrough end-to-end
- `src/attractor/tests/graph.test.ts` — adjust for shape/type table changes
- `docs/superpowers/specs/2026-05-05-shallow-control-flow-handlers-design.md` — design doc
- `docs/superpowers/plans/2026-05-05-shallow-control-flow-handlers.md` — plan (chunk 1 marked complete)

## Decisions and patterns
- `diamond → conditional` shape mapping kept even after `ConditionalHandler` deletion: authored diamond nodes still route through the engine's conditional path, and the inline passthrough at the dispatch site makes the dispatch type-stable without resurrecting a handler class.
- `partial_success` collapsed out of `OutcomeStatus` because the only producer was `FanInHandler` (now gone) and the only non-test consumer was a renderer branch in `pipeline.ts`. Internal-only union, no public surface impact.
- Supersedes prior illumination `2026-05-01T0423-janitor-parallel-handler-yagni.md` — that one flagged only the parallel half; this session folded conditional in and finished the cleanup in a single commit.
- Zero `.dot` pipeline edits: verified no bundled or scenario pipeline references `type=conditional`, `type=parallel`, or `type=parallel.fan_in` literally; the 5 pipelines using parallelogram shapes route through shape→type mapping that still resolves correctly.

## Gotchas and constraints
- The conditional dispatch passthrough lives at the same site as the `isExitNode` shape-marker check. Future readers adding new "shape-marker" pseudo-types should add them to that same dispatch block, not as full `NodeHandler` classes — the seam is reserved for node types that encapsulate real per-type work (agent, tool, wait-human, store, manager-loop, start/exit).
- `OutcomeStatus` is now `"success" | "retry" | "fail"`. Anything reintroducing branch fan-in must add its own union member rather than reviving `partial_success`.
- `branchOutcomes` is no longer part of `HandlerExecutionContext`; reintroducing fan-in cannot lean on it as a free hand-off slot.

## Learnings from the run
- **Trace not locatable from `run_id`.** `~/.ralph/<projectKey>/runs/$run_id/pipeline.jsonl` does not exist for this run_id (`433e874d-f17e-481a-856a-e41528db930a`). Searching every `pipeline.jsonl` under `~/.ralph` for that run_id returned zero matches. Run-dir names on disk are 8-char short ids (e.g. `f6b021e5`), not the UUIDs the pipeline injects via `$run_id`. This means the memory-writer step 2 procedure as written cannot succeed for any current run — it must be evidence-only until the trace path mismatch is fixed. This is the exact gap captured in the just-added illumination `2026-05-05T1056-memory-writer-trace-locate-gap.md`. Without trace evidence I can't count `agent.success=false` retries or tmux fix cycles; the only available signal is git log.
- **Single-commit chunk.** `git log 22748b8..HEAD` shows the entire implementation landed in one commit (`1fa6811`) with the plan-completion bookkeeping in a follow-up (`0706aad`). No tmux-tester fix commits — consistent with `tmux_tester.test_summary` reporting cycle-1 pass.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build green, full test suite passed (140 files, 1267 tests) including all 14 .ralph/scenarios/* smoke pipeline-folder tests (conditional, gate, store, agent-implement, chat-end-to-end, etc.) which directly exercise the engine dispatch path touched by commit 1fa6811. No fixes needed.
