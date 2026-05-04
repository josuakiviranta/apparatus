---
date: 2026-05-04
run_id: cf661057-d208-42e3-b432-050de1c74f79
plan: docs/superpowers/plans/2026-05-04-janitor-string-attrs-drift.md
design: docs/superpowers/specs/2026-05-04-janitor-string-attrs-drift-design.md
illumination: meditations/illuminations/2026-05-01T0513-janitor-string-attrs-drift.md
test_result: pass
---

# Janitor: STRING_ATTRS drift in graph.ts validator

## What was implemented
`pipeline validate` now flags `$var` typos inside `cwd=` attributes — bringing
validate-time signal in line with `pipeline run`, which already errored on the
same class of typo via the runtime expander.

## Key files
- `src/attractor/core/graph.ts` — replaced two hardcoded 4-element field arrays
  (variable_coverage at 260-265, checkOrphanOutput at 647-648) with iteration
  over the imported `STRING_ATTRS` constant.
- `src/attractor/transforms/variable-expansion.ts` — retired the keep-in-sync
  comment at 135-136 now that there is one source of truth.
- `src/attractor/tests/graph.test.ts` — added a `cwd=` case to the
  variable_coverage suite.
- `docs/superpowers/specs/2026-05-04-janitor-string-attrs-drift-design.md` — design.
- `docs/superpowers/plans/2026-05-04-janitor-string-attrs-drift.md` — plan.

All implementation lives in commit `1a6bce0`.

## Decisions and patterns
- Frame the user-visible benefit as **signal-time consistency between
  `pipeline validate` and `pipeline run`**, not crash-prevention. The runtime
  already errored (`UndefinedVariableError` / missing-input) on `$var` typos
  inside `cwd=`; only `validate` was silent. Pinned during chat refinement
  after the assistant's first framing oversold it.
- Frame the change as a **reduction** in hardcoded strings (two arrays → one
  shared constant), not an addition. Caller raised this concern explicitly.
- `pipeline run` semantics unchanged. No new error paths, no message changes.
  Surface change is `validate`-only.
- Portability-heuristic at `graph.ts:333` left untouched — separate change.

## Gotchas and constraints
- `STRING_ATTRS` is exported from `variable-expansion.ts` and is the canonical
  list (5 entries: `prompt`, `toolCommand`, `label`, `scriptArgs`, `cwd`).
  Future additions to the runtime expander must propagate automatically to
  both validator rules now that they iterate the shared constant.
- The retired keep-in-sync comment was a smell that survived past its expiry
  date — when adding similar shared-constant patterns, prefer importing over
  documenting the duplication.

## Final verification
- test_result: pass
- test_summary: One cycle, no fixes needed. Phase 1 build + npm test green:
  134 files, 1257 tests passed in 15.93s. Phase 2: all 14 smoke pipelines
  covered by `pipeline-smoke-*-folder.test.ts` (vitest) — green. Phase 3:
  validated `.ralph/pipelines/illumination-to-implementation/pipeline.dot`
  (exit 0, 17 nodes/27 edges) and confirmed the new `cwd=` scan flags
  `$bogusvar` on a synthetic typo pipeline — exactly the behaviour committed
  in 1a6bce0.
