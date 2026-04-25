---
date: 2026-04-25
status: open
description: illumination-to-implementation.dot dispatches two artifacts (illumination + plan) but closes neither — delegating closure to a janitor whose write path is broken in dontAsk mode; two tool nodes at the terminal would close both in the same run that opened them, without requiring janitor write access.
---

## Core Idea

The open/close meta-meditation says: design the pair, not the half. `illumination-to-implementation.dot` dispatches an illumination (`mark_dispatched`) and creates a plan (`plan_writer`) — two openings — but closes neither. Closure was delegated to the janitor. The janitor's write path is broken: the MCP server is not registered in `permissionMode: dontAsk` runs (confirmed open follow-up in `IMPLEMENTATION_PLAN.md`). The pipeline already holds `$illumination_path` and `$plan_path` in context at `memory_writer` time. Two tool nodes before `done` would close both artifacts in the same run that opened them, with zero janitor dependency on the happy path.

## Why It Matters

T1300 (`pipeline-never-closes-the-plan`) prescribes adding `mark_plan_implemented` at the terminal. That is necessary but not sufficient. Even with `status: implemented` written to the plan file, the janitor still cannot call `mark_implemented` on the illumination because its MCP server fails to register in headless `dontAsk` mode — the blocking bug documented in `IMPLEMENTATION_PLAN.md` under "Janitor agent MCP server not registered in headless runs." The result: fixing T1300 alone leaves every dispatched illumination permanently suspended, just in a different limbo (plan closed, illumination still dispatched).

The pipeline is better positioned than the janitor to close both artifacts:
- `$illumination_path` is produced by `verifier` (line ~6 of the pipeline) and is in context the entire run.
- `$plan_path` is produced by `plan_writer` and is in context from that node forward.
- The pipeline runs in interactive mode (`headless_safe=false`), where MCP injection is known to work.
- The janitor's nightly role becomes pure reconciliation (orphans, pre-existing debt, manual fixes) rather than primary closure — a much smaller and more reliable target.

The three dispatched orphan illuminations from T1100 (`2026-04-14T0300`, `2026-04-14T1200`, `2026-04-14T0800-plans-have-no-lifecycle`) are a separate historical-debt problem and do not gate the forward fix.

## Revised Implementation Steps

1. **Add `close_plan` tool node to `illumination-to-implementation.dot`** immediately after `memory_writer`, before `done`. Use `script_file="scripts/mark-plan-implemented.mjs"` (or call the existing `mark_plan_implemented` MCP tool directly via a `type=tool` node with `cwd="$project"` and `script_args="$plan_path"`). The node should be fail-soft: if the plan file has no frontmatter or is already implemented, log and continue — do not abort.

2. **Add `close_illumination` tool node** immediately after `close_plan`, before `done`. Mirror the `mark_dispatched` node but call `scripts/mark-implemented.mjs` (or equivalent) with `$illumination_path`. Again fail-soft: if the illumination is already implemented or the path is invalid, log and continue.

3. **Route `mark_archived → done` remains unchanged** — the archive branch is already a terminal and needs no closure node (archiving IS the closure for the false path).

4. **Fix the three T1100 orphan dispatched illuminations manually.** For each of the three plans referenced by `plan_path` in those illumination files, verify the plan file exists and has `status: implemented` frontmatter (the backfill script in `scripts/backfill-plan-frontmatter.sh` should have handled this). Then call `mark_implemented` on each illumination from a `ralph meditate --steer` session, where the MCP server DOES register correctly in interactive mode.

5. **Add a contract test to `pipelines/tests/illumination-to-implementation.artifacts.test.ts`** asserting that a node named `close_illumination` (or equivalent) exists in the graph and that it appears on the path from `memory_writer` to `done`. This prevents the closure node from being accidentally dropped in future pipeline edits — the same gap that let T1300 persist since the pipeline was first authored.
