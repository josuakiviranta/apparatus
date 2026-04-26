---
date: 2026-04-26
status: open
description: T1300 fixes why mark_plan_implemented doesn't fire (shadow procedure), but even after that fix the closure is still inside agent cognition — structurally optional — while mark_dispatched (the open half) is a tool node and therefore structurally mandatory; the correct fix mirrors the dispatch pattern: two tool nodes after memory_writer close both artifacts deterministically.
---

## Core Idea

`mark_dispatched` is a pipeline tool node — it fires deterministically as a graph edge regardless of what the agent thinks. `mark_plan_implemented` and `mark_implemented` (illumination closure) are rubric steps — they fire only if the agent's cognition reaches them. T1300 correctly identifies that the node prompt's numbered list creates a stopping point before the rubric's lifecycle steps, and proposes removing that list. But removing the list is a partial fix: even with the shadow procedure gone, closure steps inside any rubric remain structurally optional. Agent cognition is non-deterministic; graph edges are not. Lifecycle closure belongs in the graph, not in an agent's attention span.

The pipeline already demonstrates the correct pattern: `plan_writer → mark_dispatched` (a tool node). The close half of every lifecycle pair should follow the same structure: `memory_writer → mark_plan_implemented_node → mark_implemented_node → done`.

## Why It Matters

The open/close lens makes this concrete: dispatch (open) is enforced at the graph layer. Close is currently enforced at the cognition layer. These are not equivalent. Every run where the agent's attention drifts, the context is long, or the structured-output schema pulls focus early will silently skip closure — and neither the pipeline tracer nor CI will report it as a failure. The janitor's reconciliation loop depends on plan status being `implemented` to close illuminations; if closure is agent-optional, the janitor's signal is permanently unreliable.

The evidence is in `pipelines/illumination-to-implementation.dot`. The `mark_dispatched` node is a sibling of `design_writer` and `plan_writer` at the graph level. There is no equivalent sibling for closure after `memory_writer`. The graph has an asymmetric open-without-close structure.

Scripts `pipelines/scripts/mark-dispatched.mjs` and `pipelines/scripts/mark-archived.mjs` prove the pattern is already established for script-based tool nodes. A `mark-implemented.mjs` (illumination) and a plan-implemented variant follow the same structure and require no engine changes.

## Revised Implementation Steps

1. **Apply T1300 first** (remove the 1–6 numbered list from the `memory_writer` node prompt; replace with input manifest + "Follow your agent-level procedure"). This makes the rubric's memory-writing steps reachable and is independently correct regardless of what happens to lifecycle closure.

2. **Write `pipelines/scripts/mark-implemented.mjs`** — mirrors `mark-dispatched.mjs`. Takes `$illumination_path` as arg, reads frontmatter, transitions `dispatched → implemented`, writes file, `git add + commit`. Idempotent: already-`implemented` is a no-op, not an error.

3. **Write `pipelines/scripts/mark-plan-implemented.mjs`** — takes the plan filename basename, reads `docs/superpowers/plans/<name>`, transitions `pending → implemented`, writes file, `git add + commit`. Same idempotency rule.

4. **Add two tool nodes after `memory_writer` in `illumination-to-implementation.dot`:**

   ```dot
   close_plan [type="tool", cwd="$project",
               script_file="scripts/mark-plan-implemented.mjs",
               script_args="$plan_path"]

   close_illumination [type="tool", cwd="$project",
                       script_file="scripts/mark-implemented.mjs",
                       script_args="$illumination_path"]

   memory_writer -> close_plan -> close_illumination -> done
   ```

   Both nodes are unconditional — no condition edges, no gate. Closure is mandatory, not a choice.

5. **Remove `mark_plan_implemented` from `memory-writer.md` rubric steps 7–8** (and from the tool whitelist if it was added there). The rubric's job is memory writing; closure is the graph's job. Keeping it in both creates ambiguity about which layer is authoritative.

6. **Add smoke coverage.** The existing `illuminate-to-implementation.artifacts.test.ts` should assert that after a pipeline run, both `$illumination_path` frontmatter reads `status: implemented` and `$plan_path` frontmatter reads `status: implemented`. This is the first end-to-end proof-of-usage for the entire lifecycle loop.
