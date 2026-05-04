---
date: 2026-05-04
run_id: 50e4080a-c6b0-47ef-a073-c69c07d940bd
plan: docs/superpowers/plans/2026-05-04-mark-plan-implemented-not-idempotent.md
design: docs/superpowers/specs/2026-05-04-mark-plan-implemented-not-idempotent-design.md
illumination: meditations/illuminations/2026-05-01T1537-mark-plan-implemented-not-idempotent.md
test_result: pass
---

# mark-plan-implemented-not-idempotent

## What was implemented

Replaced the `markPlanImplemented` MCP tool (and its `pending|implemented` plan-status enum + `list_plans` status filter) with a new `consume_plan(filename, reason)` tool that mirrors the shipped illumination `consume`: `git rm` the plan file and commit `meditate: consume <filename> (<reason>)`. Eliminated the failure class instead of patching idempotency.

## Key files

- `src/cli/mcp/illumination-server.ts` — added `consumePlan` (mirrors `consume` at `:85-92`), registered new MCP tool, deleted `markPlanImplemented`, dropped `z.enum(["pending","implemented"])` plan schema and `list_plans` status filter.
- `src/cli/tests/illumination-server.test.ts` — replaced `markPlanImplemented` cases with `consume_plan` cases (10 references).
- `src/cli/tests/meditate.test.ts`, `src/cli/tests/janitor-agent.test.ts` — tool-whitelist swap (`mark_plan_implemented` → `consume_plan`).
- `pipelines/illumination-to-implementation/memory-writer.md` — call swap; removed best-effort softening (new call is intrinsically idempotent).
- `pipelines/illumination-to-implementation/plan-writer.md` — dropped `status: pending` directive (`:45`).
- `docs/superpowers/plans/*.md` — stripped `status:` frontmatter from 2 plan files (`2026-05-01-janitor-dead-parse-structured-output.md`, `2026-05-03-janitor-dead-scripts.md`).
- `docs/superpowers/specs/2026-05-04-mark-plan-implemented-not-idempotent-design.md` — design doc (sibling to ADR-0002).

Session commits: `02f83f1` (add consume_plan), `3db060b` (swap callers), `d1e7558` (delete markPlanImplemented + status filter).

## Decisions and patterns

- **Pivoted in chat round 1** from the original illumination scope (idempotent flip) to consume-only plan lifecycle. Trigger: user inspected `docs/superpowers/plans/` and found `status:` frontmatter was already drifted (5 of 11 plans carried it; 4 of those held values outside the schema enum — `complete`, `done`). Patching idempotency would leave the drift.
- Mirrored ADR-0002 (`2026-04-30-consume-only-illumination-lifecycle.md`) shape exactly — same `git rm` + commit-message pattern, no frontmatter manipulation. Reuse over invention.
- Skipped sibling ADR-0003 — design doc references ADR-0002 directly; new-tool surface is structurally identical.
- Tail-node best-effort/never-abort softening for lifecycle calls became unnecessary once the call is intrinsically idempotent (already-removed file is the same outcome).

## Gotchas and constraints

- `consume_plan` operates on a basename from `docs/superpowers/plans/`. The tool resolves the path internally; callers must pass `basename` only, never a full path.
- `docs/superpowers/plans/` is gitignored at the repo root — `consume_plan`'s `git rm` works because the files were committed with explicit `git add -f` (or pre-existed before the gitignore). Honor the same pattern when adding plan files.
- The 2 plan files that were stripped of `status:` were never within-schema (`complete`, `done` aren't in the enum). The frontmatter strip is therefore lossless cleanup, not state mutation.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build succeeded and 1248/1248 tests across 134 files passed (covers consume_plan MCP tool, illumination-server, smoke-folder harnesses, pipeline preflight, validate, show). No fixes required. Smoke pipelines under pipelines/smoke/* were not driven via `ralph pipeline run` because every one spawns a live Claude agent session (hard-rule skip); vitest smoke-folder suites already exercise their wiring and all passed.
