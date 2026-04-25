---
date: 2026-04-25
status: open
description: The pipeline built dispatch (open) but never built its close pair — two 30-line mirror scripts and two terminal tool nodes are the entire fix, no engine changes required.
---

## Core Idea

Ten illuminations (T1000 through T0900) have diagnosed the same symptom: the pipeline never closes its artifacts. The `open-close` lens makes the fix legible. `mark_dispatched` was built as an opener — it routes the illumination from `open` to `dispatched` and records the plan path. Its closure pair (`mark_implemented` for the illumination, `mark_plan_implemented` for the plan) was never built as pipeline-executable scripts. Every prior illumination named the absence of a caller. This one names the shape of the caller: two `.mjs` files and two tool nodes, direct mirrors of `scripts/mark-dispatched.mjs` which is already in the project at 30 lines.

## Why It Matters

`scripts/mark-dispatched.mjs` demonstrates the exact pattern:
1. Read a file at a full path argument
2. Parse frontmatter
3. Assert expected status, handle idempotent re-run (exit 0 if already in target state)
4. Rewrite the `status:` line
5. Append metadata field(s)
6. `git add` + `git commit`, emit JSON

`markPlanImplemented()` and `markImplemented()` already exist as pure helpers in `src/cli/mcp/illumination-server.ts`. The MCP tool registrations are live. What does not exist is the `.mjs` script layer that lets a pipeline tool node call them without needing agent MCP config. T1700 confirmed `implement` has `mcp: []`. T0900 confirmed `memory_writer` has `mcp: []`. Tool nodes bypass this entirely — they run shell scripts, not agent MCP calls. The scripts are the missing bridge.

The pipeline `illumination-to-implementation.dot` already routes `mark_dispatched -> implement` and ends at `memory_writer -> done`. The two new terminal nodes slot in before `done` on every success path, the same way `mark_dispatched` slots in before `implement`.

## Revised Implementation Steps

1. **Write `pipelines/scripts/mark-implemented.mjs`** — accepts `<illumination_path>` (full path). Parse frontmatter, assert `status === "dispatched"` (exit 0 idempotently if already `implemented`, error otherwise). Rewrite `status: dispatched` → `status: implemented`, append `implemented_at: YYYY-MM-DD`. Git add + commit. Emit `{ marked_implemented: illuminationPath }` as JSON. Mirror `mark-dispatched.mjs` structure exactly.

2. **Write `pipelines/scripts/mark-plan-implemented.mjs`** — accepts `<plan_path>` (full path). Same pattern: assert `status === "pending"`, rewrite to `status: implemented`, commit. Exit 0 idempotently if already `implemented`. Emit `{ marked_plan_implemented: planPath }` as JSON.

3. **Add two tool nodes to `illumination-to-implementation.dot`** — insert between `memory_writer` and `done`:
   ```dot
   close_illumination [type="tool", cwd="$project",
     script_file="scripts/mark-implemented.mjs",
     script_args="$illumination_path"]

   close_plan [type="tool", cwd="$project",
     script_file="scripts/mark-plan-implemented.mjs",
     script_args="$plan_path"]
   ```

4. **Reroute terminal edges** — replace `memory_writer -> done` with:
   ```dot
   memory_writer -> close_illumination -> close_plan -> done
   ```

5. **Add idempotency tests** — in `pipelines/scripts/tests/`, add `mark-implemented.test.mjs` and `mark-plan-implemented.test.mjs` using the same fixture pattern as `mark-dispatched.test.mjs`. Cover: happy path, already-closed (idempotent exit 0), wrong prior status (exit 1).

6. **Smoke-verify end-to-end** — run `illumination-to-implementation.dot` against a real `open` illumination. Confirm the terminal illumination ends in `status: implemented` and the plan ends in `status: implemented` in `git log --oneline`.
