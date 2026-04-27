---
date: 2026-04-27
run_id: 00135639-ed28-4452-be6f-7a58f545da4f
plan: docs/superpowers/plans/2026-04-27-pipeline-show-two-open-seams.md
design: docs/superpowers/specs/2026-04-27-pipeline-show-two-open-seams-design.md
illumination: meditations/illuminations/2026-04-27T1459-pipeline-show-two-open-seams.md
test_result: fail
---

# pipeline-show-two-open-seams

## What was implemented

Extracted the duplicated `formatDiag` closure from `pipelineValidateCommand` and `pipelineShowCommand` into a single shared helper `formatPipelineDiag` in `src/cli/lib/pipeline-diag-format.ts`, with a unit test pinning the exact `file:line:col [rule] message` output. Pure internal DRY — no user-facing output change. Marked illuminations T2500 and T1459 implemented.

## Key files

- A `src/cli/lib/pipeline-diag-format.ts` — new shared helper
- A `src/cli/tests/pipeline-diag-format.test.ts` — pins format string
- M `src/cli/commands/pipeline.ts` — both call sites now import the helper; inner closures deleted
- M `meditations/illuminations/2026-04-20T2500-pipeline-graph-preview-command.md` — marked implemented
- M `meditations/illuminations/2026-04-27T1459-pipeline-show-two-open-seams.md` — marked implemented

## Decisions and patterns

- **Test-first commit order.** Format-pinning test (`077692b`) landed before the helper itself (`4b22bcd`), then refactor (`a39d046`). Test is load-bearing for the no-output-change guarantee — if the helper is ever edited, drift between two callers cannot be silent.
- **SVG-staleness check deferred.** Step 2 of the illumination (mtime-based `[stale_svg]` advisory) was conditional on `pipeline lint` (T2400) shipping; not invented here. Only steps 1, 3, 4, 5 of the 5-step scope landed this run.
- **`pipeline show` flag surface locked.** No new flags. `--focus` / `--flow` / `--mermaid` ideas from original T2500 deferral require a fresh illumination per scope lock recorded in refinements.
- **Verifier corrections carried into chat notes.** Illumination cited the second `formatDiag` at ~line 601 and `pipelines/smoke/conditional.svg` as a stale SVG candidate; verifier corrected both (real line is `1068`; real committed SVGs are `pipelines/illumination-to-implementation.svg` and `pipelines/janitor.svg`). Spec writer used the corrected references.

## Gotchas and constraints

- Both pre-extraction `formatDiag` closures were byte-identical — a future reader who finds the test "redundant" should remember it is the only thing preventing silent format drift between the two callers.
- The helper signature is `(d, src, relPath)` and depends on `renderCodeFrame`. Keep that frame call inside the helper, not at the call site, or both callers will lose carets.
- `pipelines/janitor.svg` is now committed alongside `pipelines/illumination-to-implementation.svg`. Neither has a staleness guard yet — when T2400 (`pipeline lint`) lands, wire the mtime check into that lane.

## Learnings from the run

- **Pipeline trace file missing.** `~/.ralph/runs/00135639-ed28-4452-be6f-7a58f545da4f/pipeline.jsonl` did not exist at memory-writer time. Could not reconstruct node-by-node retry/duration evidence. If trace persistence is intentional this is a gap; if it is a regression, future runs should validate the JSONL exists before tail nodes assume it.
- **tmux-tester reported FAIL but root cause was pre-existing working-tree state.** The 2 vitest failures (`src/cli/tests/illumination-to-plan-pipeline.test.ts:13,:20`) are ENOENT against `pipelines/illumination-to-plan.dot`, which is deleted in the working tree (status `D`) and predates this run's commits (`077692b`/`4b22bcd`/`a39d046`/`4509086`). Tester correctly declined to "fix" out-of-scope state. Pattern worth keeping: tester should diff its red signal against the session's actual commit range before applying fixes.
- **`ralph --version` drift observed.** Tester noted CLI prints `0.1.1` while `package.json` is `0.1.43`. Not from this run's commits, but flagged for a future cleanup pass.

## Final verification

- test_result: fail
- test_summary: 1 cycle. Build green. Vitest: 1114 passed, 2 failed — both in src/cli/tests/illumination-to-plan-pipeline.test.ts and caused by the working-tree deletion of pipelines/illumination-to-plan.dot, a pre-existing untracked-state condition NOT introduced by this run's commits (077692b/4b22bcd/a39d046/4509086). 9 smokes ran clean (static-multi-node, agent-implement, agent-json-vars, tool, tool-runtime-vars, store, json-schema-stream, conditional, gate, missing-caller-var). 4 interactive smokes (chat-only, chat-end-to-end, meditate-steer, tmux-tester) skipped per hard rule against driving Claude/meditate sessions. No fixes applied — the only red signal is pre-existing repo state outside this node's scope.
