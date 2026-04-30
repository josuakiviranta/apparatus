---
date: 2026-04-30
status: archived
archived_at: 2026-04-30
archive_reason: Superseded by opposite-direction consolidation; bundled pipelines now live under src/cli/pipelines/ rather than top-level pipelines/. See IMPLEMENTATION_PLAN.md "Bundle Pipelines Under src/cli/pipelines/" plan.
description: All pipelines moved to top-level pipelines/ folder-form except implement, still alone in src/cli/pipelines/ — last splinter to consolidate.
---

## Core Idea

Every pipeline now lives in `pipelines/<name>/pipeline.dot` (folder-form, per-folder agents) — except `implement`, which is still a flat pair `src/cli/pipelines/implement.dot` + `implement.md`. One leftover splinter from before the chunk-4 per-folder migration. The vision says pipelines are cross-project orchestration logic; keeping `implement` buried in `src/cli/` contradicts that and makes the bundled-vs-user-authored boundary muddy.

## Why It Matters

- `glob_files` shows 14 folder-form pipelines under `pipelines/` plus stranded `src/cli/pipelines/implement.{dot,md}`. Two layouts, one engine.
- `tsup.config.ts` and `assets.ts` likely carry a special copy rule for `src/cli/pipelines/` — extra asset path = extra place to break (memory entry `tsup-multi-entry-path-issues` is already on file).
- Memory `2026-04-16-implement-as-pipeline.md` records that `implement` became a thin pipeline shim — but it never finished the move into `pipelines/implement/`. Half-finished migration.
- Future authors will copy whichever layout they see first → drift compounds.

## Revised Implementation Steps

1. Create `pipelines/implement/` and move `src/cli/pipelines/implement.dot` → `pipelines/implement/pipeline.dot`, `implement.md` → `pipelines/implement/implement.md`.
2. Update `src/cli/commands/implement.ts` (and any resolver in `src/cli/lib/pipeline-resolver.ts`) to load from the unified `pipelines/` root.
3. Remove the `src/cli/pipelines/` copy rule from `tsup.config.ts` and any branch in `src/cli/lib/assets.ts` that special-cases that path.
4. Update `src/cli/tests/tsup-templates-copy.test.ts` + `assets.test.ts` to assert single layout.
5. Grep for `src/cli/pipelines` across repo + memory; replace stale references in specs/architecture.md and specs/commands.md.
6. Run smoke suite (`pipeline-smoke-*`) plus `implement.test.ts` to confirm nothing path-binds to old location.
7. Delete empty `src/cli/pipelines/` folder; commit as one move so git history shows the consolidation.
