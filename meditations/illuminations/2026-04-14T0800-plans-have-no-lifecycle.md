---
date: 2026-04-12
status: implemented
description: The illumination state machine tracks open/dispatched/implemented/archived but the 20-file plans directory has no lifecycle frontmatter — at least one plan (meditate-backpressure-guard) is confirmed unimplemented with no signal in the repository that distinguishes it from complete plans.
dispatched_at: 2026-04-25
plan_path: docs/superpowers/plans/2026-04-25-plans-have-no-lifecycle.md
implemented_at: 2026-04-25
---

## Core Idea

`docs/superpowers/plans/` contains 20 implementation plans. Not one has a `status` field in its frontmatter. The illumination state machine — implemented in v0.1.12 — tracks whether each illumination is `open`, `dispatched`, `implemented`, or `archived`, and exposes `list_illuminations(status=open)` to query it. No equivalent exists for plans. At least one plan is confirmed orphaned: `2026-04-12-meditate-backpressure-guard.md` has an approved spec and complete TDD steps, but `src/cli/commands/meditate.ts` has no backpressure guard. The plan is real; the feature is absent; nothing in the repository marks the gap.

## Why It Matters

The `illumination-to-plan.dot` pipeline ends at `plan_writer → done`. The illumination's status moves to `dispatched` — tracked, queryable, not re-processed. The plan is written to disk — untracked, queryable only by reading the file, not re-processable because nothing knows it needs to be. The pipeline correctly closes the loop on the illumination side and leaves the plan side open.

This asymmetry is not abstract. `2026-04-12-meditate-backpressure-guard.md` is the concrete failure mode: a plan that sat in `docs/superpowers/plans/` through multiple sessions, while `ralph meditate` continued running without a backlog check and the illumination corpus kept growing. The plan's existence provides no pressure to implement it because nothing surfaces it as pending.

The filesystem-as-memory lens names what's missing: memory that is write-only is not memory — it's a log. The 20 plan files are a log. No session can query `list_plans(status=pending)` and learn what remains to be built. A developer resuming after any gap must read 20 files and cross-check each against the codebase. The illumination system made the observation corpus queryable; it did not extend the same care to the plan corpus.

There is also a secondary symptom: all 20 plans were written during active dev sessions, not produced by the `illumination-to-plan.dot` pipeline. The pipeline's `plan_writer` has never run successfully end-to-end. Every plan in the directory has a human author, not a pipeline. This means the `plan_writer` node has never stamped a plan with any creation metadata — no `created_at`, no `illumination_source`, no `status: pending`. When the pipeline does run end-to-end, its output will be indistinguishable from the existing manually-authored plans.

## Revised Implementation Steps

1. **Implement the backpressure guard from `2026-04-12-meditate-backpressure-guard.md`.** The spec and plan are both complete. It is a ~30-line change in `src/cli/commands/meditate.ts` and one `--force` option in `src/cli/program.ts`. Add `countIlluminations()`, the threshold check (`RALPH_MEDITATE_MAX_OPEN` env var or `--force`), and write the three unit tests (count below threshold; count at/above without force → early exit; count at/above with `--force` → proceeds). This is the shortest path from "plan exists" to "plan closed" and directly addresses the runaway corpus problem every illumination in the last session observed.

2. **Add `status: pending` frontmatter to every file in `docs/superpowers/plans/`.** This is a hand-edit pass — no new code. Set `status: complete` for plans whose features exist in the codebase (e.g., `illumination-state-machine`, `mark-implemented-lifecycle`, `top-level-directory-inventory`). Set `status: pending` for those that don't (at minimum: `meditate-backpressure-guard`, `headless-governance-gates`, and the seven 2026-04-14 plans not yet verified). This pass produces the ground truth that all subsequent tooling can read.

3. **Add a `list_plans` function to `illumination-server.ts`, parallel to `listIlluminations`.** Read `docs/superpowers/plans/*.md`, parse the `status` field from frontmatter (default: `pending` if absent, for forward compatibility with existing files), filter by optional `status` argument, return filename + description. This is 30 lines following the `listIlluminations` pattern exactly. Expose it as an MCP tool named `list_plans`. Add it to the meditate agent's tool whitelist in `src/cli/agents/meditate.md`.

4. **Update the `plan_writer` prompt in `illumination-to-plan.dot` to write `status: pending` in the plan's frontmatter.** One sentence added to the prompt: "Begin the plan file with frontmatter containing `status: pending` and `illumination_source: <filename>` where filename is the illumination that generated this plan." This makes every pipeline-produced plan queryable from day one and distinguishable from manually-authored plans by the `illumination_source` field.

5. **Add a unit test: `countIlluminations` + `meditateCommand` guard logic.** Write test cases before implementing step 1. Three cases: (a) empty directory → proceeds, (b) 5 files and `RALPH_MEDITATE_MAX_OPEN=5` → early exit with warning message on stdout, (c) 5 files with `force: true` → proceeds. These tests will fail. Then implement. This is the TDD step that makes the backpressure guard verifiable before marking its plan `complete`.
