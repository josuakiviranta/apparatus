---
date: 2026-04-09
description: The 1300 fix (save currentNode: nextEdge.to) is correct for normal edges but wrong for loop_restart edges — nextEdge.to is a phantom sentinel, and the checkpoint must instead be saved AFTER the reset with currentNode: startNode.id and completedNodes: [].
---

## Core Idea

Illumination 1300 recommended a single-line fix for the success-path resume bug: replace `currentNode: node.id` with `currentNode: nextEdge.to` in the Advance checkpoint save. For normal edges this is correct — resume starts at the next unexecuted node. For `loop_restart` edges, `nextEdge.to` is a phantom sentinel node that the engine never traverses to: `loop_restart` semantics causes the engine to ignore `nextEdge.to` entirely and jump to `startNode.id`. If the checkpoint records `currentNode: sentinel`, resume will find the sentinel node, attempt to run its handler, and either fail with "No handler for type X" or execute a placeholder node that was never meant to run. The correct checkpoint state after a `loop_restart` transition is `{ currentNode: startNode.id, completedNodes: [], nodeRetries: {}, context: { reset values } }` — saved AFTER the reset, reflecting the engine's actual new state. Currently the engine saves no checkpoint at the reset point, leaving the pre-reset checkpoint as the last known state.

## Why It Matters

The fix order in illumination 1700 says: fix engine bugs 0900 and 1300 before the prompt fix 1500. That ordering assumes 0900 and 1300 are independent and complete. They aren't, in the `loop_restart` case.

The engine code in `src/attractor/core/engine.ts` has a single Advance block that applies to both normal edges and `loop_restart` edges:

```ts
// Advance
completedNodes = [...completedNodes, node.id];
await saveCheckpoint(opts.logsRoot, {
  currentNode: node.id,        // ← 1300 fix: should be nextEdge.to, but...
  completedNodes,
  ...
});

const nextEdge = selectNextEdge(...);

if (nextEdge.loopRestart) {
  completedNodes = [];          // ← reset: but checkpoint was already saved with old state
  nodeRetries = {};
  context = { "$goal": ... };
  currentNodeId = startNode.id;
  continue;
}
```

If 1300 is fixed naively (`currentNode: nextEdge.to`), the checkpoint for a loop_restart edge records `currentNode: sentinel` with the pre-reset `completedNodes`. On resume: engine loads the sentinel node, tries to execute it, fails. The `idempotency-run-it-twice` lens names the exact failure mode: the recovery path (resume) fails the user precisely when they are already in a bad state (interrupted pipeline).

The `the-agentic-loop-is-a-graph` lens promises that "a failure mid-graph is not a full restart." For loop_restart pipelines, this promise breaks at two levels: the checkpoint before the reset records stale state, and the naive 1300 fix makes resume actively harmful rather than merely wrong.

Three properties converge here:

1. **The fix target is a code region, not a code line.** The Advance checkpoint save is a single `saveCheckpoint` call, but it covers three distinct transitions: normal advance, loop_restart, and exit-node completion. Each transition needs its own checkpoint semantics. Treating the fix as a line change conflates all three.

2. **No test catches the loop_restart resume case.** The `resumes from checkpoint` test in `src/attractor/tests/engine.test.ts` uses a synthetic checkpoint with no loop_restart involvement. No test runs a pipeline through a `loop_restart` transition, captures the checkpoint it produces, and then verifies resume starts from `startNode.id` with empty `completedNodes`.

3. **The 1500 prompt fix enables this failure.** Once `PROMPT_pipeline_create.md` correctly documents `loop_restart`, Claude will author looping pipelines. The first time a user interrupts a looping pipeline mid-loop and tries `--resume`, they will hit this bug. The 1700 illumination established fix order for 0900 and 1300 before 1500 — but applying 1300 without accounting for the loop_restart case produces a different bug that 1500 then exposes. The engine is not safe to pair with a corrected prompt until the loop_restart checkpoint is also fixed.

## Revised Implementation Steps

1. **Split the Advance block into two checkpoint paths.** In `engine.ts`, compute `nextEdge` BEFORE calling `saveCheckpoint`. Then branch:
   ```ts
   const nextEdge = selectNextEdge(node, outcome, context, edges);
   if (!nextEdge) { return { status: "fail", ... }; }

   completedNodes = [...completedNodes, node.id];

   if (nextEdge.loopRestart) {
     // Reset first, then checkpoint the reset state
     completedNodes = [];
     nodeRetries = {};
     context = { "$goal": graph.goal ?? "" };
     if (opts.project) context["$project"] = opts.project;
     await saveCheckpoint(opts.logsRoot, {
       timestamp: new Date().toISOString(),
       currentNode: startNode.id,  // ← post-reset state
       completedNodes,             // ← [] after reset
       nodeRetries,
       context,
     });
     currentNodeId = startNode.id;
     continue;
   }

   // Normal advance
   await saveCheckpoint(opts.logsRoot, {
     timestamp: new Date().toISOString(),
     currentNode: nextEdge.to,    // ← 1300 fix applies cleanly here
     completedNodes,
     nodeRetries,
     context,
   });
   currentNodeId = nextEdge.to;
   ```
   This applies the 1300 fix (`nextEdge.to`) only where it is semantically correct.

2. **Add a loop_restart resume test to `engine.test.ts`.** Write a pipeline with `work -> sentinel [loop_restart=true]` where `work` visits twice (first pass: normal run; second pass: via resume). The test should:
   - Run `runPipeline` once with `resume: false`, interrupt before the pipeline finishes the second loop pass by stopping at the checkpoint written after `work`
   - Run `runPipeline` again with `resume: true` against the same `logsRoot`
   - Assert `fakeRunLoop` is called exactly once more (resume runs `work` zero additional times if the checkpoint was saved correctly, or once if a retry is needed)
   - Assert `result.status === "success"` and `result.completedNodes` does not contain duplicate `work` entries

3. **Apply 0900 (completedNodes deduplication) in the same commit.** The loop_restart reset already clears `completedNodes`, so for a clean resume from a post-reset checkpoint, the deduplication in 0900 is not strictly required. But in the window between the first loop execution and the loop_restart, the bag still grows. Fix both in one commit.

4. **Add the loop_restart case to the scenario test.** In `test-attractor-pipeline.sh`, add a sub-test: run `work_test.dot` with a synthetic checkpoint pointing to `startNode.id` with `completedNodes: []` (simulating a post-loop-restart resume) and assert the pipeline completes without calling any node twice.

5. **Update the fix-order documentation (illumination 1700's steps).** The engine fix now has three pieces — 0900, 1300-normal-edges, and 1300-loop-restart — all of which must ship before the prompt fix 1500 is deployed. The 1700 illumination's steps 1 and 2 remain valid but need a sub-step: "include the loop_restart checkpoint split as part of the 1300 fix."
