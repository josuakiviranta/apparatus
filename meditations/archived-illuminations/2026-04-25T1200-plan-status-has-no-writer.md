---
date: 2026-04-25
status: archived
description: mark_plan_implemented is a live MCP tool and the janitor reads plan status to close illuminations, but no pipeline node writes `status: implemented` after work ships — so every plan the automated pipeline produces stays pending indefinitely, and the janitor's reconciliation loop has a permanent open seam at the plan-completion boundary.
archived_at: 2026-04-27
reason: Plan closure already wired via memory-writer rubric step 7a calling mark_plan_implemented MCP tool
---

## Core Idea

`mark_plan_implemented` shipped as part of `plans-have-no-lifecycle` and the janitor reads `plan.status == "implemented"` as its sole trigger to close a dispatched illumination. But no node in `pipelines/illumination-to-implementation.dot` writes that value after the implementing commit lands. Every plan the pipeline produces ships with `status: pending` and stays there until a human — or an implementing agent following a one-time manual step specific to that plan — explicitly flips the frontmatter. The janitor has `mark_plan_implemented` in its tool whitelist but its rubric has zero instructions for calling it; the tool is reachable but procedurally dead.

## Why It Matters

The lifecycle loop is: illuminate → dispatch → plan (`pending`) → implement → plan (`implemented`) → janitor closes illumination. Seven illuminations were reconciled in today's janitor run, but every one of those plans had its status set outside the pipeline — via the `plans-have-no-lifecycle` backfill script or via a one-time manual step in that same plan's body (Task 3.5.5: "the implementing agent's last action is to call `markPlanImplemented`"). The automated pipeline path has never produced a `status: implemented` plan file.

The consequences compound:

- `list_illuminations status=dispatched` will accumulate new entries as fast as the illumination-to-implementation pipeline runs; the janitor can only close illuminations whose plans were manually blessed
- `pipelines/scripts/mark-plan-implemented.mjs` does not exist — only `mark-dispatched.mjs` exists as a structural reference; `mark_plan_implemented` is only callable from the MCP server, not from a pipeline tool node
- The `plans-have-no-lifecycle` design assumed the implementing agent would flip the plan at session end; that assumption is not encoded in any pipeline or rubric, making it session-local intent rather than durable wiring

The filesystem-as-memory lens names the gap precisely: the plan file is shared memory between the pipeline (producer) and the janitor (reader). The write path at plan-completion is missing. Every other phase of this lifecycle has a writer — `mark_dispatched.mjs` writes dispatch, `markImplemented` in the MCP server writes illumination closure, the janitor writes new illuminations as findings. Plan completion has no equivalent.

## Revised Implementation Steps

1. **Create `pipelines/scripts/mark-plan-implemented.mjs`** as a near-copy of `mark-dispatched.mjs`. Accept one argument: plan basename (no path). Read `docs/superpowers/plans/<basename>`, rewrite `status: pending` → `status: implemented` in frontmatter, auto-commit with `meditate: mark plan <basename> implemented`. Exit 1 on file-not-found, already-implemented, or no-frontmatter. Add `pipelines/scripts/tests/mark-plan-implemented.test.mjs` covering happy path + three error cases (mirrors `mark-dispatched.test.mjs` shape).

2. **Add a `store` node before `done` in `pipelines/illumination-to-implementation.dot`** that extracts `basename($plan_path)` into a `plan_basename` context variable — needed because tool nodes receive string args, not path expressions. Wire: `commit_push → extract_plan_basename [store] → mark_plan_done [tool] → done`.

3. **Add the `mark_plan_done` tool node** in `pipelines/illumination-to-implementation.dot` with `tool_command="node pipelines/scripts/mark-plan-implemented.mjs"` and `tool_args="$plan_basename"`. This mirrors the existing `mark_dispatched` tool node at the pipeline's entry. The pipeline then symmetrically opens and closes the plan lifecycle.

4. **Add a rubric trigger to `src/cli/agents/janitor.md`** for the whitelisted `mark_plan_implemented` tool: after Step 2 ("reconcile dispatched illuminations"), insert a sub-step — "For each pending plan whose `illumination_source` illumination is `status: implemented`, call `mark_plan_implemented`." This closes the reverse-direction case: plans that outlived their illumination due to out-of-order closures.

5. **Add a pipeline shape assertion** in `pipelines/tests/illumination-to-implementation.artifacts.test.ts` that `mark_plan_done` exists, has `tool_command` pointing at the new script, and is topologically between `commit_push` and `done`. This is the same pattern used for existing artifact tests in that file.
