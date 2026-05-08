---
date: 2026-05-08
run_id: 3dbc24b8
plan: docs/superpowers/plans/2026-05-08-pipeline-list-hides-half-the-roster.md
design: docs/superpowers/specs/2026-05-08-pipeline-list-hides-half-the-roster-design.md
illumination: .apparat/meditations/illuminations/2026-05-07T2210-pipeline-list-hides-half-the-roster.md
test_result: pass
---

# pipeline-list hides half the roster

## What was implemented
`apparat pipeline list` now renders bundled and project-local pipelines together under two grouped headers, with fork pairs tagged on both rows (`(forked → local)` / `(shadowed by local)`); the lying `apparat pipeline create` empty-state hint is gone. A new `listAllPipelines(project)` seam in `pipeline-resolver.ts` is the single source of truth — backed by a parity vitest that asserts every name from `listAllPipelines` resolves via `resolvePipelineArg`.

## Key files
- `src/cli/lib/pipeline-resolver.ts` — added `listAllPipelines` seam (commit 7640fc8)
- `src/cli/commands/pipeline/list.ts` — rewritten on top of the seam, grouped + fork-aware (commit 4422dca)
- `src/cli/program.ts` — `addHelpText` simplified to point at `pipeline list`
- `src/cli/tests/pipeline-list-seam.test.ts` — new (seam unit)
- `src/cli/tests/pipeline-list-resolver-parity.test.ts` — new (parity guard)
- `src/cli/tests/pipeline-preflight.test.ts` — refactored from `.slice()` to per-line parsing
- `src/cli/tests/pipeline.test.ts` — updated for grouped output
- `README.md` — commands section updated

## Decisions and patterns
- Single-source-of-truth seam: both `pipeline list` and `resolvePipelineArg` resolve names via the same two-tier walk; parity test wires drift to a red vitest.
- Fork pairs get marked on **both** rows (local and bundled), not just one — so an operator running `pipeline run janitor` can see exactly why it resolves to their fork.
- `--origin bundled|local|all` flag was explicitly held out of default scope (stretch only) — chat round confirmed user did not pull it in.
- Doc-edge audit (CONTEXT.md, two 2026-04-30 historical bundle plans, `skills/apparatus/pipelines.md`) all already read correctly post-fix; no semantic edits needed there.

## Gotchas and constraints
- `pipeline-preflight.test.ts:89-93` previously used `.slice()` between known names — that pattern silently breaks the moment list output gains rows. Per-line parsing is the durable shape; future list edits must keep parsing line-based.
- `meditate` has no `goal=` declared in its `pipeline.dot` today, so it renders `(no goal defined)` — list output gracefully degrades; not a bug, but the UI surfaces it loudly.

## Learnings from the run
- Pre-existing failure surfaced but untouched: `apparat pipeline run .apparat/scenarios/static-multi-node/pipeline.dot` looks for `node_a.md` (underscore) while folder ships `node-a.md` (hyphen). tmux-tester flagged it explicitly as untouched-by-this-diff. Worth a separate triage illumination — not in scope here.

## Final verification
- test_result: pass
- test_summary: Single cycle clean: 1379 vitest tests pass; 6 non-interactive scenarios green live in tmux (tool, store, tool-runtime-vars, conditional, missing-caller-var, plus pipeline-list manual smoke); fresh-init smoke shows bundled roster and fork tagging on both rows. No fixes needed. static-multi-node failure is pre-existing (hyphen-vs-underscore agent filename mismatch in scenario folder, untouched by this diff).
