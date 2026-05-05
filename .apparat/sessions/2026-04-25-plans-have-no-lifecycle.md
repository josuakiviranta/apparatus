---
date: 2026-04-25
run_id: e192f052-703c-483a-8843-fb8b498b382d
plan: docs/superpowers/plans/2026-04-25-plans-have-no-lifecycle.md
design: specs/2026-04-25-plans-have-no-lifecycle-design.md
illumination: meditations/illuminations/2026-04-14T0800-plans-have-no-lifecycle.md
test_result: pass
---

# Plans Have No Lifecycle — Frontmatter + MCP Lifecycle Tools

## What was implemented
Every plan in `docs/superpowers/plans/` now carries `status: pending|implemented` frontmatter, and the meditate MCP server gained `list_plans` + `mark_plan_implemented` tools (auto-commit on call) so any whitelisted agent can flip a plan's lifecycle without human hand-edit.

## Key files
- `src/cli/mcp/illumination-server.ts` — added `listPlans` + `markPlanImplemented` (parallel to `listIlluminations` / `markDispatched`); registered both tools.
- `src/cli/tests/illumination-server.test.ts` — listPlans filter + description fallback + markPlanImplemented happy path / error coverage.
- `src/cli/agents/meditate.md` — whitelisted `list_plans` + `mark_plan_implemented` (12 illumination tools total).
- `src/cli/agents/plan-writer.md` — required `status: pending` + `illumination_source` frontmatter on emitted plans.
- `pipelines/illumination-to-plan.dot` — `plan_writer` prompt enforces frontmatter emission.
- `scripts/backfill-plan-frontmatter.sh` — one-shot script; rewrites legacy `proposed`/`open` and inserts frontmatter on unstamped plans.
- `docs/superpowers/plans/*.md` — 47 plans backfilled to `pending` or `implemented`; 1 stale-`open` rewritten.
- `src/cli/tests/meditate.test.ts` — assertion bumped to 12 tools.

## Decisions and patterns
- Plan lifecycle is **binary** (`pending` / `implemented`), narrower than the illumination state machine's four-state machine. Vocabulary parity: `implemented`, never `complete`.
- Transition is **agent-driven via MCP**, never human hand-edit. `mark_plan_implemented` auto-commits the frontmatter flip, mirroring `markDispatched` / `markArchived` (commits 5875b69, 8f5b5af).
- Caller identity is **not pinned** — any agent with the tool whitelisted can call it. Pinning would re-introduce a coordination point and break autonomy.
- Backfill must close out **every** existing plan; an unstamped or stale-`open` plan is just as invisible as today's no-frontmatter state.

## Gotchas and constraints
- `scripts/backfill-plan-frontmatter.sh` requires bash 4+ (associative arrays); macOS ships bash 3.2 by default — must invoke via `/opt/homebrew/bin/bash` or similar. Documented in the script header.
- The script's first revision matched only `pending`/`implemented` in its rewrite branch and fell through to INSERT for legacy `proposed`/`open`, producing duplicate `status:` lines. Fix in 36520cd: entry condition now matches all four legacy values.
- `markPlanImplemented` auto-commits — callers must not pre-stage unrelated changes in `docs/superpowers/plans/` or they'll piggyback into the lifecycle commit.
- The illumination's "step 1" (backpressure-guard implementation) was contextual example only, NOT in scope. Its own plan already exists.

## Learnings from the run
Trace gap: `~/.ralph/runs/e192f052-…/pipeline.jsonl` does not exist. Per-node `status.json` files at `~/.ralph/runs/illumination_to_implementation/` were the only evidence (the run dir uses the pipeline slug, not the run_id UUID — confirmed for future memory-writers).

From per-node status + git log:
- `implement` node: 1 iteration, success on first pass (`agent.iterations=1`, `agent.success=true`).
- `tmux_tester`: 1 cycle, 0 fix commits — full suite (1090/1090) green and 3 smoke pipelines clean on first try.
- One mid-implement self-correction worth flagging: the backfill script needed commit 36520cd to handle legacy `proposed`/`open` statuses correctly. Caught by the implementing agent before the verifier; not a tmux-tester fix.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build OK, 1090/1090 tests passed (90 files), 3 smoke pipelines (tool, static-multi-node, conditional) reached exit nodes with success. Phase 3 verified the diff: all 49 plans in docs/superpowers/plans/ carry status frontmatter (5 pending + 44 implemented = 49 ✓), and list_plans/mark_plan_implemented are registered in src/cli/mcp/illumination-server.ts. No fixes needed.
