---
date: 2026-05-10
run_id: 65963be4
plan: docs/superpowers/plans/2026-05-10-runs-folder-is-an-opaque-graveyard.md
design: docs/superpowers/specs/2026-05-10-runs-folder-is-an-opaque-graveyard-design.md
illumination: .apparat/meditations/illuminations/2026-05-07T2312-runs-folder-is-an-opaque-graveyard.md
test_result: pass
---

# runs-folder-is-an-opaque-graveyard

## What was implemented

Deepened `apparat pipeline list` so `pipeline list <name>` now zooms into a
recent-runs table for a single pipeline (Layer 2), backed by per-pipeline GC
retention (default K=10 + stricter K=5 bucket for crash-at-start dirs) and
slug-prefixed runIds (`<pipeline-slug>-<uuid8>`). `pipeline trace` accepts
both new slug-prefixed and bare 8-char ids for back-compat.

## Key files

- `src/cli/lib/apparat-paths.ts` — `newRunId(pipelineName?)` returns slug-prefixed id
- `src/cli/lib/runs-index.ts` (new) — `listAllRuns` parser
- `src/cli/commands/pipeline/list.ts` — Layer-2 recent-runs section
- `src/cli/commands/pipeline/run.ts` — slug-prefixed runId + GC deferred to `onPipelineStart`
- `src/cli/commands/pipeline/runs-gc.ts` — `gcOldRunsPerPipeline` replaces flat `gcOldRuns`
- `src/cli/commands/pipeline.ts` — wires per-pipeline GC
- `src/cli/program.ts` — positional `[name]` on `pipeline list`
- `src/cli/tests/apparat-paths-slug-format.test.ts` (new)
- `src/cli/tests/apparat-paths.test.ts` — slug + bare regex coverage
- `src/cli/tests/runs-index.test.ts` (new) — crash/in-progress/failure/sort
- `src/cli/tests/runs-gc-per-pipeline.test.ts` (new)
- `src/cli/tests/pipeline-runs-gc.test.ts` — migrated to per-pipeline buckets
- `src/cli/tests/pipeline-list-layer2.test.ts` (new) — Layer-1 pin then Layer-2
- `src/cli/tests/pipeline-trace-runid-compat.test.ts` (new) — slug + bare resolve
- `src/cli/tests/pipeline-run-runid.test.ts` / `pipeline.test.ts` — slug regex
- `README.md`, `src/cli/skills/apparatus/pipelines.md` — doc surface

## Decisions and patterns

- Deepen one verb (`pipeline list`) rather than add a sibling `pipeline runs`
  command — applied the deep-modules-hide-complexity stimulus. One symbol,
  two projections (static roster + time-axis runs) behind one verb.
- Copy-paste navigation: each Layer-1 row prints
  `→ apparat pipeline list <name>`; each Layer-2 row prints
  `→ apparat pipeline trace <runId>`. No `--limit` / `--failed` /
  `--runs` flags — per-pipeline GC retention bounds the table to ~10 rows.
- Self-describing folder names: `.apparat/runs/janitor-533e1a8c/` over
  bare `533e1a8c`. `pipeline trace` parser tolerates both shapes for
  back-compat with existing folders and external scripts.
- GC rebucketing: project-global newest-N replaced by per-pipeline newest-K
  (default 10) plus a stricter K=5 bucket for crash-at-start dirs (no
  `pipeline.jsonl` or no `pipeline-start`). A meditate crash-loop can no
  longer evict last week's only successful illumination run.
- `APPARAT_RUNS_KEEP` env semantics shifted from project-global to
  per-pipeline-K — breaking but intentional.
- Deferred (not in this cycle): failure-footer history hint (gated on
  `2026-05-09-pipeline-failure-handoff-is-shallow-design.md`) and
  daemon-runs merge (gated on `2026-05-09-two-run-homes-no-cross-project-view-design.md`).
  Both companion specs are still `Status: draft`.

## Gotchas and constraints

- `gcOldRuns` (flat mtime sort) deleted — call sites must use
  `gcOldRunsPerPipeline`. The pre-claim stub-JSONL trick in `run.ts` was
  removed; GC now fires from `onPipelineStart` so the active run's
  pipeline name is known before any directory scan.
- Existing tests that asserted runId regex `/^[0-9a-f]{8}$/` had to widen
  to accept the slug-prefixed shape. Any external tool grepping
  `.apparat/runs/<8hex>` will need updating.
- `pipeline trace <runId>` resolution: tries exact dir first, then falls
  back to `endsWith(`-${bareId}`)` scan — keep both branches when editing.
- `docs/superpowers/specs/` treated as historical reference, not binding —
  the user explicitly waived the mission-control spec's "no new commands"
  line for this scope.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: 161 test files / 1442 tests green; 5 scenarios driven live (static-multi-node, conditional, pipeline-failure-footer, tool, store) all behaved as designed; slug-prefixed runId composition verified at runtime (`static-multi-node-b92fcebf`, `tool-smoke-eb0cd32b`, `store-smoke-774cd0a6`, `pipeline-failure-footer-ffe48935`); `pipeline trace` accepts both new slug-prefixed and bare 8-char runIds; Layer-2 zoom (`pipeline list janitor`) renders the new `recent runs:` section; no fixes needed.
