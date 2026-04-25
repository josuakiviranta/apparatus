---
date: 2026-04-25
status: open
description: illumination-to-implementation.dot ends at memory_writer without writing status: implemented to the plan file — making the janitor's closure trigger permanently unreachable and every dispatched illumination immortal.
---

## Core Idea

`illumination-to-implementation.dot` terminates at `memory_writer → done`. `memory_writer` writes a session log and pushes code — but never flips the plan's `status: pending` to `status: implemented`. The janitor's step 2 reads `list_plans status=implemented` to find plans whose illuminations can be closed. Because no actor writes that status, every dispatched illumination stays `dispatched` in perpetuity. T1200 named this gap; this illumination names the exact fix.

## Why It Matters

The lifecycle chain has four steps that must all land: illuminate → dispatch illumination → implement plan → close illumination. Step three has been running since v0.1.22 without completing step four. `meditations/illuminations/` is accumulating dispatched items with no path to `implemented`. The janitor (`pipelines/janitor.dot`) was built precisely to drive step four — but its trigger is `plan_path` resolving to a plan with `status: implemented`, and no plan in `docs/superpowers/plans/` currently has that status (confirmed: `2026-04-22-agent-rubric-prepend.md` is the one exception, set manually). Every future `illumination-to-implementation.dot` run will repeat the same omission until a terminal script node is added.

The shape of the fix already exists in the codebase: `pipelines/scripts/mark-dispatched.mjs` (23 lines) reads a file path, checks current status, rewrites frontmatter, and emits JSON. `mark-plan-implemented.mjs` is that script minus the `plan_path` argument.

## Revised Implementation Steps

1. **Create `pipelines/scripts/mark-plan-implemented.mjs`** — mirrors `mark-dispatched.mjs` in shape. Accepts one argument: `<plan-path>`. Reads the plan file, verifies `status: pending`, replaces with `status: implemented`, writes back. Idempotent: if already `implemented`, exit 0 with `{ idempotent: true }`. ~20 lines.

2. **Create `pipelines/scripts/tests/mark-plan-implemented.test.mjs`** — three tests: happy path (pending → implemented), idempotent (already implemented exits 0), wrong status (exits non-zero). Mirrors `mark-dispatched.test.mjs` layout.

3. **Add `mark_plan_implemented` node to `illumination-to-implementation.dot`** — insert between `memory_writer` and `done`:
   ```dot
   mark_plan_implemented [type="tool",
                          cwd="$project",
                          script_file="scripts/mark-plan-implemented.mjs",
                          script_args="$plan_path"]
   ```
   `$plan_path` is already in context at this point (set by `plan_writer`).

4. **Rewire the terminal edges** — replace `memory_writer -> done` with `memory_writer -> mark_plan_implemented -> done`. The `mark_archived -> done` and `verifier -> done [condition="preferred_label=empty"]` edges stay unchanged — they exit before a plan is ever created.

5. **Run `ralph pipeline validate pipelines/illumination-to-implementation.dot`** and confirm `$plan_path` resolves on all paths that reach `mark_plan_implemented`. Add to the existing `pipelines/tests/illumination-to-implementation.artifacts.test.ts` contract: assert that `mark_plan_implemented` node exists, has `script_file="scripts/mark-plan-implemented.mjs"`, and routes to `done`.
