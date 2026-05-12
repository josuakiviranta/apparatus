---
date: 2026-05-12
run_id: parallel-illumination-to-implementation-7565cf19
plan: /Users/josu/Documents/projects/apparatus/docs/superpowers/plans/2026-05-12-plan-scheduler-shape-consumer-collision.md
design: /Users/josu/Documents/projects/apparatus/docs/superpowers/specs/2026-05-12-plan-scheduler-shape-consumer-collision-design.md
illumination: .apparat/meditations/illuminations/2026-05-12T0952-plan-scheduler-shape-consumer-collision.md
test_result: pass
---

# plan-scheduler-shape-consumer-collision

## What was implemented
Moved the shape-consumer-collision fix upstream from `plan_scheduler` into `plan_writer`: the planner agent now Greps importers/consumers of any symbol or path a chunk creates/renames/deletes/changes-signature on, and propagates every match landing in another chunk's target file into that chunk's `Modify:`/`Test:` declarations. Scheduler stays mechanical; the trace event lands as a text warning (`plan_writer.under_declared_shape_consumer_suspected`) instead of a schema variant.

## Key files
- `c1` `c400a0c` — `.apparat/scenarios/scheduler-shape-collision/{chunked-plan.md, pipeline.dot}` + `src/cli/tests/scheduler-shape-collision-scenario.test.ts` (smoke scenario fixture + regression test)
- `c2` `3104906` — `.apparat/pipelines/parallel-illumination-to-implementation/plan-writer.md` (new Procedure step) + `src/cli/tests/parallel-illumination-to-implementation-plan-writer.test.ts` (prompt regression test)
- `c3` `3b8634c` — `CONTEXT.md` (plan_writer glossary annotation) + `README.md` (parallel-pipeline paragraph)
- `405441f` — `.apparat/scenarios/scheduler-shape-collision/tmux-tester.md` (self-skip marker added during verification)

## Decisions and patterns
- Fix lives in `plan_writer` (upstream — has Read/Grep/Glob/Task tools and existing path-grounding mandate), not `plan_scheduler` (downstream — under hard "no LLM creativity" rule, `plan-scheduler.md:81`). Upstream has both context and latitude; downstream has neither by design.
- Rule stated in general form (type-shape, rename, delete, signature, constant, schema) — not LiveFooter-specific. Tested explicitly during chat_session for generalization.
- Six structural blind spots carved out as out-of-scope: behavior-only, cross-language, runtime-order, test-state, dynamic imports, codegen. For apparatus only behavior-only is a real risk and belongs to the integration test suite.
- Trace event reframed as text warning emitted from `plan_writer`'s response, not a `NodeEvent` union variant — keeps `pipelineEvents.ts` and `dag-schema.ts` untouched.
- Deferred: scheduler-side shape-edit/consume heuristic. Earns its complexity only if `plan_writer` tightening fails on a later incident. A literal path-overlap heuristic over declared files would not have caught `fe4624db` anyway (c2/c3's declared files had ∅ intersection).
- Scenario fixture is documentation-only — DOT has no `agent=` attributes, contract is asserted by the TS regression test, not by running the pipeline. Required a `tmux-tester.md` self-skip marker because `tmux_tester` discovers every folder under `.apparat/scenarios/`.

## Gotchas and constraints
- Adding a doc-only DOT to `.apparat/scenarios/` without a `tmux-tester.md` self-skip marker crashes the tester (resolves nodes to a missing `implement.md`). Future doc-only scenario fixtures must ship the self-skip marker alongside the DOT.
- The new Procedure step relies on `plan_writer`'s existing Grep tool — no frontmatter change needed. If the agent's tool list ever shrinks, the step silently degrades.
- The text warning (`plan_writer.under_declared_shape_consumer_suspected`) is freeform — downstream consumers (memory-mining, stream-formatter) cannot match it structurally. Acceptable for now; revisit if a second incident motivates structured emission.

## Final verification
- test_result: pass
- test_summary: Cycle 1: build + 1578-test suite green; new scheduler-shape-collision pipeline.dot crashed when run because nodes carry no `agent=` (plan author marked it doc-only, but tmux-tester runs every scenario it discovers). Fixed by adding `.apparat/scenarios/scheduler-shape-collision/tmux-tester.md` self-skip marker (commit 405441f). Cycle 2: scheduler-shape-collision now SKIP, static-multi-node sanity scenario PASS in ~17s.
