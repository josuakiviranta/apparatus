---
date: 2026-04-08
description: The engine's resume test uses a synthetic checkpoint where the current node is not yet in completedNodes — a state the success path never produces — so the re-execution bug on resume passes silently every time.
---

## Core Idea

The `runPipeline` success path saves a checkpoint with `currentNode: node.id` AFTER appending `node.id` to `completedNodes`. On resume, `currentNodeId` is set to `cp.currentNode` — the node that already succeeded — and the engine re-executes it. The resume test in `engine.test.ts` passes because it constructs a checkpoint with `currentNode: "work"` but `completedNodes: ["start"]` — `work` is absent, so one execution is correct. That checkpoint state is never produced by the engine itself. A real success-path checkpoint has `work` in `completedNodes`, and resume will run `work` again.

## Why It Matters

The `the-agentic-loop-is-a-graph.md` lens names resumability as one of the three core properties of a graph-based loop. The engine has a checkpoint mechanism, tests pass, and the property appears satisfied. It isn't. The test proves the wrong thing.

`currentNode` is semantically ambiguous across two code paths in `engine.ts`:

- **Retry path** (line ~155): `currentNode: node.id`, `node.id` NOT in `completedNodes`. This is correct — "resume by running this node again, it failed."
- **Success path** (line ~175): `currentNode: node.id`, `node.id` IS in `completedNodes`. This is wrong — "resume by running this node again, even though it succeeded."

The fix for the success path is one line: save `currentNode: nextEdge.to` instead of `currentNode: node.id`. But the test gap means this bug has no regression coverage. The test at `src/attractor/tests/engine.test.ts:90` ("resumes from checkpoint") constructs its own checkpoint manually, which makes it a test of "does the engine handle this checkpoint shape" rather than "does the engine produce a checkpoint it can resume from."

Three prior illuminations orbit this area without landing here:
- `2026-04-12T0900` identified `completedNodes` as a bag, not a set — the bag grows during normal loop operation
- The retry path checkpoint is correct — it resets to the failed node, which is not in `completedNodes`
- Neither illumination looked at what the success-path checkpoint produces and whether resuming from it is correct

The interaction: when the 0900 bag fix is applied (deduplication), the resume re-execution bug becomes visible for the first time — `work` is in `completedNodes` once, runs again, and now appears twice again. The two bugs mask each other during testing.

## Revised Implementation Steps

1. **Fix the success-path checkpoint in `engine.ts`**. Compute `nextEdge` before saving the checkpoint, then save with `currentNode: nextEdge.to`. The retry-path checkpoint stays as-is — `currentNode: node.id` is correct there because the node didn't succeed:
   ```ts
   // after: completedNodes = [...completedNodes, node.id]
   const nextEdge = selectNextEdge(node, outcome, context, edges);
   if (!nextEdge) { /* fail */ }
   await saveCheckpoint(opts.logsRoot, {
     timestamp: new Date().toISOString(),
     currentNode: nextEdge.to,   // ← was: node.id
     completedNodes,
     nodeRetries,
     context,
   });
   currentNodeId = nextEdge.to;
   ```

2. **Fix the resume test in `engine.test.ts`**. The existing test constructs a synthetic checkpoint where `work` is not yet in `completedNodes`. Replace it with two sub-tests that match real engine state:
   - **Sub-test A (success resume)**: checkpoint is `{ currentNode: "done", completedNodes: ["start", "work"] }`. Assert `fakeRunLoop` is NOT called — `work` already succeeded, resume starts at exit node.
   - **Sub-test B (retry resume)**: checkpoint is `{ currentNode: "work", completedNodes: ["start"] }`. Assert `fakeRunLoop` IS called once — `work` failed and needs to run.

3. **Add an integration-style test**: run a full pipeline, capture the checkpoint written to `logsRoot`, then run `runPipeline` again with `resume: true` against the same `logsRoot`. Assert `fakeRunLoop` is called exactly once per non-resume run, and zero times on resume (all nodes already completed). This is the only test that can catch future regressions in checkpoint production.

4. **Apply the 0900 deduplication fix alongside**. Fix `completedNodes` bag → set in the same commit. These two bugs interact — fixing only one leaves the other hidden. After both fixes, the checkpoint file for a looping pipeline remains bounded and resume does not re-run already-successful nodes.
