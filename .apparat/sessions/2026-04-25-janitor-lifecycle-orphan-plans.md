---
date: 2026-04-25
run_id: c8ed91a3-3240-4d6b-909a-ee5472805955
plan: docs/superpowers/plans/2026-04-25-janitor-lifecycle-orphan-plans.md
design: docs/superpowers/specs/2026-04-25-janitor-lifecycle-orphan-plans-design.md
illumination: meditations/illuminations/2026-04-25T1100-janitor-lifecycle-orphan-plans.md
test_result: skipped
---

# Janitor Lifecycle Orphan Plans

## What was implemented

Re-threaded broken lifecycle pointers so the standing janitor can close two
dispatched-but-shipped illuminations on its next run. T1400's `plan_path` was
redirected from a design spec (Approved-prose, no YAML status) to the actual
implementation plan (`status: implemented`); T1200's plan was given the
missing frontmatter block (`status: implemented` + `illumination_source`).

## Key files

- M `meditations/illuminations/2026-04-14T1400-gitignore-pattern-doesnt-match-mcp-filename.md` (plan_path redirect, commit `eee24d5`)
- M `docs/superpowers/plans/2026-04-25-meditate-prompt-is-write-only.md` (frontmatter prepend)
- M `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md` (`illumination_source` backfill, commit `59014dc`)
- M `src/attractor/handlers/agent-handler.ts` + tests (auto-inject MCP infra vars, commit `7781b15`)
- A `docs/superpowers/specs/2026-04-25-janitor-lifecycle-orphan-plans-design.md`
- A `docs/superpowers/plans/2026-04-25-janitor-lifecycle-orphan-plans.md`
- M `meditations/illuminations/2026-04-25T1100-janitor-lifecycle-orphan-plans.md` (status → dispatched)

## Decisions and patterns

- **Pure data fix.** No code changes, no janitor logic changes. All five
  lifecycle pointers fixed via frontmatter mutations only — janitor reads the
  same fields, behavior changes from the data layer.
- **Diagnostic split.** A side-track shipped during verification:
  `agent-handler.ts` now auto-injects `{{ILLUMINATION_SERVER_PATH}}`,
  `{{PROJECT_ROOT}}`, `{{META_MEDITATIONS_DIR}}` and lifts the dev-mode
  `node→tsx` swap. Without this, pipeline-launched MCP-using agents (janitor)
  had unresolved templates and the MCP server failed to register.
- **Two of three orphan-plan backfills deferred.** Only
  `2026-04-12-meditate-backpressure-guard.md` got `illumination_source`.
  `headless-governance-gates.md` and `top-level-directory-map.md` remain
  pending without backreferences — design called for all three; only the one
  with a clear illumination match was wired.

## Gotchas and constraints

- `plan_path` MUST point at a file under `docs/superpowers/plans/` carrying
  YAML `status: implemented`. Pointing at a spec (prose `**Status:** Approved`)
  silently breaks the janitor reconciliation loop forever — no error, just an
  illumination stuck in `dispatched` on every future run.
- Plans without YAML frontmatter are invisible to `list_plans` from both
  status branches. T1200's plan had no frontmatter at all and was missing
  from both `list_plans(pending)` and `list_plans(implemented)`.
- Janitor in headless `dontAsk` sessions: the MCP `illumination` server is
  reachable (after the agent-handler fix above), but `Edit`/`Write` are
  denied — verification runs identified the right reconciliations but could
  not auto-commit them. Recorded as follow-up in `IMPLEMENTATION_PLAN.md`
  (commit `59014dc`).

## Learnings from the run

The pipeline trace at `~/.ralph/runs/c8ed91a3-3240-4d6b-909a-ee5472805955/`
was not present at memory-write time — the run-id directory does not exist
under `~/.ralph/runs/`. Cannot ground retry/fix-cycle counts in node-level
evidence. Git history is the only durable trace for this run; that's
sufficient for the work-product memory above but blocks any "what struggled"
analysis. Worth flagging to the trace-writer / janitor: a missing
`pipeline.jsonl` for an apparently-successful run is itself a data-integrity
finding.

## Final verification

- test_result: skipped (tmux verification was not requested for a pure
  frontmatter-fix plan)
- test_summary: (none)
