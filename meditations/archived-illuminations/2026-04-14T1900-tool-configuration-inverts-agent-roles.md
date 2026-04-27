---
date: 2026-04-13
status: archived
description: The state machine's lifecycle transition tools (mark_dispatched, mark_archived, mark_implemented) were configured into the meditate agent — which says "I cannot implement anything" — while the implement agent that runs every pipeline node was left with mcp: [].
archived_at: 2026-04-25
reason: Inversion already fixed by commit 089e954 stripping lifecycle tools from meditate.md
---

## Core Idea

`meditate.md` holds all nine illumination MCP tools including `mark_dispatched`, `mark_archived`, and `mark_implemented` — the full set of lifecycle mutation tools. `implement.md` has `mcp: []`. The `illumination-to-plan.dot` pipeline runs every node — including `mark_dispatched` and `mark_archived` — with `agent="implement"`. The reflective agent has executive powers. The executive agent has none. The tool configuration is an inversion of the role design.

This traces to IMPLEMENTATION_PLAN.md Chunk 5: "Meditate agent whitelist updated." That update was correct in intent but applied to the wrong file. The pipeline was already using `agent="implement"` for all nodes. Updating `meditate.md` completed the unit tests (692 pass) without making the pipeline's lifecycle nodes functional.

## Why It Matters

The meditate agent's own prompt says explicitly: "Your role is reflective, not executive — you observe, think, and write insights. You cannot and will not implement anything." Yet `meditate.md` contains `mark_implemented`, `mark_dispatched`, and `mark_archived` — the three tools that mutate lifecycle state. The implement agent, which is the executor for every pipeline phase including the `mark_dispatched` node between `design_writer` and `plan_writer`, has zero MCP tools.

T1700 named "implement agent cannot close the loop" focusing on `mark_implemented`. This is broader: the pipeline's `mark_dispatched` and `mark_archived` nodes are equally broken. The `illumination-to-plan.dot` pipeline cannot complete any path — true or false — because both terminal lifecycle transitions (`mark_dispatched` on the approval path, `mark_archived` on the remove/decline paths) use `agent="implement"` with no MCP access.

The agentic-loop-is-a-graph lens makes the failure precise: the graph structure is correct — nodes are named, transitions are explicit. But the graph's executor lacks the tools its own nodes require. The graph knows what it needs to do; the agent doesn't have the means to do it.

All 18 open illuminations in the corpus are blocked behind this single configuration gap. The backpressure guard (T0300, T1100) and the verifier population fix (T1800) are secondary — neither matters until `agent="implement"` can call MCP tools.

## Revised Implementation Steps

1. **Move lifecycle transition tools out of `meditate.md`.** Remove `mark_implemented`, `mark_dispatched`, and `mark_archived` from `meditate.md`'s `tools:` list. The meditate agent's role is observation and writing only — `write_illumination` is the correct boundary of its executive authority. The remaining six tools (`list_illuminations`, `read_file`, `glob_files`, `project_tree`, `list_meta_meditations`, `read_meta_meditation`) are all read-only or write-new; keep those.

2. **Add the MCP block and lifecycle tools to `implement.md`.** Copy the three-field `mcp:` entry from `meditate.md` (`name: illumination`, `command: node`, `args: [...]`). Add to `tools:`: `mark_dispatched`, `mark_archived`, `mark_implemented`, and `list_illuminations`. Do not add `write_illumination` — the implement agent must not create new illuminations; that is meditate's role. The `list_illuminations` tool (with `status=open`) gives the implement agent structured access to the backlog at session start.

3. **Verify that `implement.ts` passes the required MCP variables.** Open `src/cli/commands/implement.ts` and confirm the `agent.run()` call passes `ILLUMINATION_SERVER_PATH`, `PROJECT_ROOT`, and `META_MEDITATIONS_DIR`. These are already resolved in `src/cli/lib/assets.ts` and already used by `runMeditationSession`. The implement command likely does not pass them — add them.

4. **Run the pipeline smoke test after the config change.** Execute `ralph pipeline run pipelines/illumination-to-plan.dot .` with a single open illumination in the corpus. Confirm the `mark_dispatched` node completes without "tool not found" error. This is the acceptance test for the fix — no new code needed, only configuration.

5. **Update IMPLEMENTATION_PLAN.md.** Add an item under "Outstanding": "Chunk 5 incomplete — meditate whitelist updated but implement whitelist was not. `mcp: []` in implement.md blocks all pipeline lifecycle transitions." This documents the gap so the next implement session does not re-close it prematurely based on the existing "COMPLETE" marker.