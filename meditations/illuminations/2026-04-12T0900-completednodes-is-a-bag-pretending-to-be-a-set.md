---
date: 2026-04-08
description: completedNodes in CheckpointState and PipelineResult is typed as a string[] bag but consumed as a set — in looping pipelines this produces unbounded checkpoint growth, with ralph-engine-test-5zoWIW/checkpoint.json on disk as 69KB of direct evidence.
---

## Core Idea

`completedNodes` in `CheckpointState` and `PipelineResult` is a `string[]` that is appended to on every node visit — including repeated visits in loops. The only consumer that reads it back uses `completedNodes.includes(n.id)`, a set operation. The type is a bag; the usage is a set. The checkpoint is rewritten after every node with this ever-growing array, so a looping pipeline produces unbounded I/O and unbounded JSON. The `ralph-engine-test-5zoWIW/checkpoint.json` sitting untracked in the repo is 69KB because the `work` node in `gate_test.dot` was visited hundreds of times and appended each time.

## Why It Matters

Three bugs hide inside this one mismatch:

**1. Checkpoint growth is unbounded.** `engine.ts:113` does `completedNodes = [...completedNodes, node.id]` unconditionally. A pipeline with an intentional retry loop (`work → check → work`) writes a larger checkpoint on every cycle. The checkpoint is read back in full on resume — a pipeline that ran for an hour before failure will load a megabyte of repeated node IDs before doing anything useful.

**2. The goal gate check is correct by accident.** `engine.ts:~87` uses `completedNodes.includes(n.id)` to verify goal gate satisfaction. This returns `true` the moment a node is visited once, which is the intended behavior. But it would continue to return `true` for every subsequent visit, meaning a goal gate node that was run 50 times due to retries is indistinguishable from one that ran once and succeeded cleanly.

**3. The caller's success metric is inflated.** `PipelineResult.completedNodes.length` is printed as "N nodes completed." In a loop, this number exceeds the actual node count in the graph — output like "Pipeline completed (47 nodes)" for a 4-node graph is misleading.

The `idempotency-run-it-twice.md` lens applies precisely: appending to `completedNodes` is not idempotent. Running a node twice doubles its representation in the array. The `the-agentic-loop-is-a-graph.md` lens promises resumability from any checkpoint — but a correct resume only needs `currentNode`, and correct goal gate validation only needs a deduplicated set. The growing bag serves neither purpose better than a compact set would.

## Revised Implementation Steps

1. **Separate the two semantics in `types.ts`.** Replace `completedNodes: string[]` in `CheckpointState` with `completedNodeIds: string[]` (deduplicated, set semantics) and add `visitCounts: Record<string, number>` for per-node visit history. Update `PipelineResult` the same way.

2. **Fix the append in `engine.ts`.** Replace:
   ```ts
   completedNodes = [...completedNodes, node.id];
   ```
   with:
   ```ts
   if (!completedNodes.includes(node.id)) completedNodes = [...completedNodes, node.id];
   visitCounts[node.id] = (visitCounts[node.id] ?? 0) + 1;
   ```
   This caps checkpoint size at the number of distinct nodes in the graph.

3. **Update the success output in `pipeline.ts`.** Change the string from `"Pipeline completed (${result.completedNodes.length} nodes)"` to `"Pipeline completed (${result.completedNodeIds.length} nodes)"` so the count reflects graph coverage, not visit frequency.

4. **Add a unit test in `engine.test.ts` for loops.** Build a graph where `work` is visited twice (via a retry edge or a conditional loop back). Assert `result.completedNodeIds` contains `work` exactly once, and `result.visitCounts["work"] === 2`.

5. **Add `ralph-engine-test-5zoWIW/` to `.gitignore`.** The pattern `ralph-engine-test-*/` will catch all future leaked test artifacts with this prefix. Determine root cause: engine tests that call `mkdtempSync` should use `afterEach(() => rmSync(dir, { recursive: true, force: true }))` — verify this is in place in `src/attractor/tests/engine.test.ts` and add it if missing.
