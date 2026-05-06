---
date: 2026-05-06
run_id: 26f7681f
plan: docs/superpowers/plans/2026-05-06-pipeline-command-orchestration-monolith.md
design: docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md
illumination: .apparat/meditations/illuminations/2026-05-06T1426-pipeline-command-orchestration-monolith.md
test_result: pass
---

# pipeline-command-orchestration-monolith

## What was implemented

Split the 762-LOC `src/cli/commands/pipeline.ts` god-module into five per-subcommand files (`pipeline/{run,show,list,validate,trace}.ts`) plus a shared `pipeline-invocation.ts` exporting a typed `loadPipeline()` seam. Old `pipeline.ts` collapsed to a barrel re-export so the 12 existing test import paths kept working.

## Key files

- Created: `src/cli/commands/pipeline-invocation.ts` (loadPipeline seam, LoadedPipeline + PipelineLoadError types)
- Created: `src/cli/commands/pipeline/{run,show,list,validate,trace,runs-gc}.ts`
- Created: `src/cli/tests/pipeline-invocation.test.ts`
- Modified → barrel: `src/cli/commands/pipeline.ts`
- Modified: `src/cli/program.ts` (direct imports of sub-command files)
- Modified: `src/attractor/core/engine.ts`, `IMPLEMENTATION_PLAN.md`, `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md` (line-number refs after split)

## Decisions and patterns

- Barrel re-export at `pipeline.ts` chosen over rewriting 12 test imports — keeps PR purely internal, zero public-contract drift.
- `PipelineLoadError` carries `src` + `relPath` so syntax-error rendering survives the seam (commit `e5ae98b` — caught during chunk-3 extraction).
- Sub-command extraction sequenced trace → list → runs-gc → validate → show → run, smallest-first to land each commit green before tackling the busiest paths.
- TDD discipline: `25fd4fa` lands failing seam tests before `f12e916` introduces `loadPipeline()`.
- `program.ts` switched to direct sub-command imports (`fbecab5`) before barrel collapse (`d2ae811`) so the barrel could shrink to pure re-export with nothing left referencing it directly.

## Gotchas and constraints

- `implement.ts` and `meditate.ts` import `pipelineRunCommand` from `../commands/pipeline.js`; the barrel must keep this export name intact.
- `heartbeat.ts:7-8` shares `parseDot`/`findVarReferences` — these now flow through `pipeline-invocation.ts`, not the old monolith. Don't reintroduce direct imports from sub-command files.
- `implement.test.ts` mocks `../commands/pipeline.js`; `meditate.test.ts` does `import * as pipelineMod`. Both rely on the barrel surface — a future cleanup that drops the barrel needs to migrate these mocks first.
- ADR-0004 and three plan docs reference `pipeline.ts` line numbers; `f8e5a87` updated those that pointed at moved code.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build OK, 144 test files / 1295 tests pass. Drove all 5 extracted pipeline sub-commands (list, validate, show, trace, run) live in tmux against the post-refactor barrel; non-claude scenarios (tool, store, tool-runtime-vars, missing-caller-var with and without --var) all reached exit codes as expected. No fixes were needed.
