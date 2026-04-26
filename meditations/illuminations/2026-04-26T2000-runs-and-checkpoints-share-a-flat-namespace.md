---
date: 2026-04-26
status: dispatched
description: Pipeline runs and checkpoints both live under the flat `~/.ralph/runs/` parent but use different keying schemes (run-id UUID vs pipeline-name slug), causing cross-project collision, two-namespace confusion in tooling, and orphaned trace dirs whenever a node fails before the first checkpoint write.
dispatched_at: 2026-04-26
plan_path: docs/superpowers/plans/2026-04-26-runs-and-checkpoints-share-a-flat-namespace.md
---

## Core Idea

`~/.ralph/runs/` currently holds two structurally different child-dir kinds in the same parent:

- `~/.ralph/runs/<run-id>/pipeline.jsonl` — keyed by 8-char UUID, one dir per invocation
- `~/.ralph/runs/<pipeline-slug>/checkpoint.json` — keyed by graph name, one dir per pipeline (overwritten each run)

Same parent, different keys, no project scope. Three concrete failures follow:

1. **Cross-project collision.** Running `illumination-to-implementation.dot` in two different projects writes to the same slug dir. The second run's checkpoint silently overwrites the first.
2. **Two-substrate observability gap.** The trace and the checkpoint live in different directories. Post-mortem tooling that inspects one cannot find the other without knowing which scheme it uses. Already documented at `memory/2026-04-25-plans-have-no-lifecycle.md:38`: `~/.ralph/runs/e192f052-…/pipeline.jsonl` did not exist; the slug dir held per-node `status.json` instead.
3. **Orphan accumulation.** No project context, no retention policy. The dir fills with old run-id traces and stale per-pipeline checkpoints from any project that ever invoked ralph.

Proposed layout: `~/.ralph/<project>/runs/<run-id>/{pipeline.jsonl, checkpoint.json}`. One dir per run, co-located trace + checkpoint, project-scoped.

## Why It Matters

Per-project isolation eliminates collision. Co-located trace + checkpoint makes `ralph pipeline runs list` trivial (`ls ~/.ralph/<project>/runs/`). Inspection tools no longer need to know whether the artefact is keyed by slug or run-id — there is one key.

The change also enables the orthogonal fix in T2100 (checkpoint-on-failure). Together they close the resume-after-API-timeout gap that motivated this illumination.

## Breaking Changes (verify each before landing)

**Code (5 sites in `src/cli/commands/pipeline.ts`):**
- `:277` slug-based `logsRoot` construction
- `:280-281` `rmSync(logsRoot)` cleanup before non-resume runs
- `:285-286` `runsRoot` for trace dir
- `:578, 582` `pipeline runs` scanner
- `:626` `pipeline trace <runId>` resolver

**Engine (`src/attractor/core/engine.ts`):**
- `:145-155` `loadCheckpoint(opts.logsRoot)` — already parameterised; just receives a different value
- `:203, 294, 313, 332, 338` `saveCheckpoint` calls — same; injected `logsRoot` swaps

**Tests:**
- `src/cli/tests/pipeline.test.ts:174-182` — explicit assertion that `logsRoot` contains `.ralph/runs/<slug>` — rewrite
- `src/cli/tests/pipeline-failure-reason.test.ts:65` — trace path format assertion — rewrite
- All other tests inject `logsRoot` via `mkdtempSync` and stay safe

**Docs (must update text):**
- `README.md:72`
- `specs/pipeline.md:83, 180, 198`
- `specs/architecture.md:136`
- `specs/commands.md:167`
- `src/cli/agents/memory-writer.md:30, 40` (`$run_id` template var description)

**Behavioural decisions still open:**
1. `--resume` lookup. Currently slug-keyed and auto-found. New model needs `--resume <run-id>` OR "latest run for this pipeline in this project" mtime lookup. Pick one.
2. Retention. Slug-keyed model auto-cleans on fresh run via `rmSync`. Per-run-id model accumulates forever; need GC policy (keep N latest, prune after M days, manual `ralph pipeline runs prune`).
3. Project-key derivation. `basename(--project)` collides for `~/foo/work` vs `~/bar/work`. Hash of absolute path is opaque. Encoded absolute path is ugly but unambiguous. Pick one and document.
4. `ralph pipeline trace <run-id>` signature. Either add `--project` or scan all projects O(n).
5. Heartbeat/cron-driven runs invoked from arbitrary cwd must still resolve "project" deterministically.
6. Migration of existing `~/.ralph/runs/*` data — write a one-off migrator, or accept fresh-start on upgrade.

**This list is not authoritative.** Re-run the breaking-changes audit before implementation: grep for `~/.ralph/runs`, `.ralph/runs`, `pipeline.jsonl`, `checkpoint.json`, `logsRoot`, `runsRoot`, `tracesRoot` across `src/`, `specs/`, `docs/`, `pipelines/`, `meditations/`, `scenario-tests/`. Any callsite not listed above is a regression risk.

## Revised Implementation Steps

1. **Lock the project-key scheme.** Decide between basename, hash, or encoded-path. Document in `specs/pipeline.md`. Without this, every other step is premature.
2. **Lock the `--resume` lookup.** Either add explicit `--resume <run-id>`, or implement mtime-based "latest run" auto-discovery. Update `specs/commands.md`.
3. **Lock the retention policy.** Decide on GC strategy or accept indefinite accumulation. Add to `specs/pipeline.md`.
4. **Re-run the breaking-changes audit** with the actual decisions from steps 1-3 in hand. The list above was compiled before those decisions and may shift.
5. **Write the migration plan** as a separate doc once the audit is final. The code change is mechanical; the migration is the risky part.
