---
date: 2026-04-09
description: ParallelHandler reads meta["branchOutcomes"] which the engine never populates, so every parallel node silently succeeds with zero branch execution — worse than the stack.manager_loop crash because the user sees "Pipeline completed" having done no parallel work.
---

## Core Idea

`ParallelHandler.execute` reads `meta["branchOutcomes"]` to assemble branch results. The engine passes exactly one meta object to every handler: `{ logsRoot, cwd, signal, outgoingLabels }`. `branchOutcomes` is never present. The handler defaults to `{}`, then returns `{ status: "success", contextUpdates: { "parallel.results": "[]" } }`. `FanInHandler` reads `parallel.results = "[]"`, parses an empty array, and returns `status: "success"` because `[].every(...)` is vacuously true. Neither handler crashes. Both succeed. No branch was executed.

The engine cannot fan out even in principle. `runPipeline` is a single-threaded `while` loop that calls `selectNextEdge` and advances to one successor per iteration. A `parallel` node with three outgoing branch edges gets exactly one of them — the highest-weight unconditional edge. The other branches are never visited. The fan-in node sees `parallel.results: []` regardless of how many branches the DOT file declares.

## Why It Matters

This is categorically different from the `stack.manager_loop` gap identified in the 2300 illumination. That case crashes: `handlers.get("stack.manager_loop")` returns `undefined`, the engine emits `failureReason: "No handler for type..."`, and the user sees a clear failure. The parallel case succeeds silently.

`PROMPT_pipeline_create.md` documents `shape=component` as "Fan-out — launches child nodes in parallel." `KNOWN_TYPES` in `graph.ts` includes `parallel` and `parallel.fan_in`. `validateGraph` passes pipelines using these shapes without a warning. `pipelineRunCommand` runs them and prints `Pipeline completed (N nodes)`. The user has no signal that the parallel branches were skipped.

The `the-agentic-loop-is-a-graph` lens names composability as one of the three core properties of a graph-based loop: "graphs can be nested, sequenced, or wired together." Parallel execution is the mechanism that enables fan-out composability. With `ParallelHandler` inert and the engine architecturally single-threaded, this composability property does not exist. What the lens promises, the engine cannot deliver — and the pipeline author will not discover this until they notice their parallel work was never done.

Two additional compounding factors:

1. **The 1500 prompt fix exposes this.** The recommended repair to `PROMPT_pipeline_create.md` (from 1500 illumination) would make pipeline authoring more accurate overall — but `component`/`parallel` is already documented in the current prompt. Every `ralph pipeline create` session today can produce a pipeline that uses parallel nodes. The bug is reachable now.

2. **No test covers the "parallel means nothing" path.** `src/attractor/tests/handlers.test.ts` tests `ParallelHandler` by passing `branchOutcomes` directly via `meta` — which the engine never does. The test validates the handler's aggregation logic in isolation and implicitly proves the meta interface contract that the engine never honors.

## Revised Implementation Steps

1. **Remove `parallel` and `parallel.fan_in` from `PROMPT_pipeline_create.md` immediately.** While the engine cannot execute parallel branches, pipeline authors must not be taught to use these shapes. Remove the `component` and `tripleoctagon` rows from the node-type table. Add a comment in the prompt: `// parallel execution not yet supported`. This is the fastest user-facing fix and requires no engine changes.

2. **Emit a `severity: "error"` diagnostic for `parallel` and `parallel.fan_in` in `validateGraph`.** Until the fan-out mechanism exists, nodes of these types should fail validation:
   ```ts
   if (t === "parallel" || t === "parallel.fan_in") {
     diags.push({ rule: "type_unsupported", severity: "error",
       message: `Node type "${t}" is declared but parallel execution is not yet implemented.` });
   }
   ```
   This makes `ralph pipeline validate` block these pipelines and `pipelineRunCommand`'s `validateOrRaise` reject them before any node runs.

3. **Add a `branchIds` field to the engine's node metadata.** When the engine visits a `parallel` node, it knows the outgoing edge targets. Pass them as `meta["branchIds"]` to the handler — this is the precursor to actual fan-out and the correct interface contract:
   ```ts
   const branchIds = edges.filter(e => e.from === node.id && !e.condition).map(e => e.to);
   const outcome = await handler.execute(node, ctx, {
     logsRoot, cwd, signal, outgoingLabels, branchIds,
   });
   ```
   `ParallelHandler` can then fail with a clear diagnostic: `"branchIds received but fan-out execution not implemented"`. This is better than silently succeeding.

4. **Implement sequential fan-out as a first step toward real parallelism.** The smallest correct implementation: when the engine visits a `parallel` node, execute each `branchId` as a sub-traversal (call `runPipeline` recursively, or run branches sequentially in the while loop via a branch queue). Collect their `PipelineResult` objects and pass them as `meta["branchOutcomes"]` to `ParallelHandler`. This makes the handler meaningful without requiring true concurrency.

5. **Fix the `handlers.test.ts` test to reflect the real meta contract.** The existing test passes `branchOutcomes` in meta directly. Rewrite it to match what the engine actually passes: no `branchOutcomes`, only `{ logsRoot, cwd, signal, outgoingLabels }`. Assert `ParallelHandler` emits a clear failure outcome (step 3's diagnostic) when `branchOutcomes` is absent. This test would have caught the inert-success bug had it matched the engine's interface.
