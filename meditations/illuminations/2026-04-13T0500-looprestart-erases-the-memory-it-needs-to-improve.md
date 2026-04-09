---
date: 2026-04-09
description: loopRestart resets context to $goal/$project only, wiping the implement.success and implement.iterations values CodergenHandler just deposited — so each retry iteration is informationally identical to the first, and the retry loop cannot learn.
---

## Core Idea

`loopRestart` in `engine.ts` resets context to `{ "$goal": graph.goal, "$project": opts.project }`. This is too aggressive. `CodergenHandler` deposits `implement.success`, `implement.iterations`, and `implement.sessionId` into context at the end of every run — exactly the feedback the next loop iteration needs to do better. The reset discards that feedback before the next iteration begins. Every retry of the loop starts with the same context as the first attempt. The retry loop has a memory mechanism (context) and erases it at the moment it would be most useful.

## Why It Matters

`the-agentic-loop-is-a-graph` identifies resumability and composability as the core properties that make graph-based pipelines valuable. A retry loop is the simplest form of composability: "do the work, evaluate, try again if needed." For retry to be meaningful, each attempt must differ from the last. In this engine, the only input path that could differ between iterations is the context map — but context is wiped at `loopRestart`.

The gap is visible in `src/attractor/core/engine.ts` at the `loopRestart` block:

```ts
if (nextEdge.loopRestart) {
  completedNodes = [];
  nodeRetries = {};
  context = { "$goal": graph.goal ?? "" };   // ← wipes everything
  if (opts.project) context["$project"] = opts.project;
  currentNodeId = startNode.id;
  continue;
}
```

And in `src/attractor/handlers/codergen.ts`, the handler that wrote the values that were just erased:

```ts
const contextUpdates: Record<string, string> = {
  "implement.iterations": String(result.iterations),
  "implement.success": String(result.success),
};
```

Three compounding factors make this invisible:

1. **`buildPreamble` is already unwired** (0300 illumination), so agents don't see context even within a single iteration. The reset compounds an existing blindness — the agent would have been blind to `implement.success` regardless. Fixing `buildPreamble` without fixing `loopRestart` restores context within iterations but still erases it between iterations.

2. **The reset is deliberate but under-specified.** Resetting `completedNodes` and `nodeRetries` is correct — goal gates should be satisfied each iteration, and retry counters should reset. But context was included in the reset without a stated reason. The effect is that the loop's "short-term memory" (completedNodes) resets correctly while its "long-term memory" (context) resets unnecessarily.

3. **No test exercises a multi-iteration loop.** The engine test for `loop_restart` that 2100 recommends writing does not yet exist. Without it, the context wipe has never been observable. The `ralph-engine-test-5zoWIW/checkpoint.json` artifact (69KB, the work node repeated hundreds of times) confirms real multi-iteration runs happen — they just leave no useful context trail.

The `loop.iteration` counter is the canary: if context persists across restarts, a trivial accumulator tells the agent "this is attempt N, prior attempts failed after K iterations." Without context persistence, this information cannot exist.

## Revised Implementation Steps

1. **Preserve context across `loopRestart` in `engine.ts`.** Change the reset block to retain all accumulated context keys, only refreshing the static graph-level values:
   ```ts
   if (nextEdge.loopRestart) {
     completedNodes = [];
     nodeRetries = {};
     // Preserve context: carry forward implement.*, meditate.*, etc.
     // Only re-assert static values in case they were overwritten
     context["$goal"] = graph.goal ?? "";
     if (opts.project) context["$project"] = opts.project;
     // Increment loop counter
     context["loop.iteration"] = String(Number(context["loop.iteration"] ?? "0") + 1);
     await saveCheckpoint(opts.logsRoot, {
       timestamp: new Date().toISOString(),
       currentNode: startNode.id,
       completedNodes,
       nodeRetries,
       context,
     });
     currentNodeId = startNode.id;
     continue;
   }
   ```
   This change is independent of — and compatible with — the 2100 checkpoint-timing fix and the 0900 deduplication fix. All three should ship together.

2. **Add `loop.iteration` to `variableExpansionTransform`.** A node prompt that says "This is attempt $loop.iteration — prior attempt ran for $implement.iterations iterations and reported $implement.success" now works. Extend variable substitution in `src/attractor/transforms/variable-expansion.ts` to include all context keys, not just `$goal` and `$project`.

3. **Add a multi-iteration context persistence test.** In `engine.test.ts`, construct a graph: `start → work → check → (loopRestart back to start if not done) / (exit if done)`. Run it where `work` fails on the first loop iteration and succeeds on the second. After completion, assert `result.context["loop.iteration"] === "1"` and `result.context["implement.iterations"]` reflects the second iteration's run (not the first's, not erased). This is the test that verifies the feedback loop exists.

4. **Wire `buildPreamble` to `CodergenHandler` (from 0300 illumination) in the same commit.** Without preamble injection, context persists in the map but is never seen by the agent. The two fixes are complements: persistence makes context available, preamble injection surfaces it to the agent. Either fix alone is incomplete. The codergen handler receives `logsRoot` in `meta` — use `loadCheckpoint(logsRoot)` there to build the preamble.

5. **Update `PROMPT_pipeline_create.md` to document `$loop.iteration`.** Once variable substitution includes context keys and loop iteration is tracked, pipeline authors can use it in node prompts. Document it alongside `$goal` and `$project` as a first-class template variable.
