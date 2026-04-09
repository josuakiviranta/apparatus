---
date: 2026-04-09
description: buildPreamble exists, is tested, and generates exactly the right context summary for agent prompts — but CodergenHandler ignores _ctx entirely, so every node runs blind to prior node outcomes regardless of what the pipeline has accumulated.
---

## Core Idea

`buildPreamble` in `src/attractor/transforms/preamble.ts` takes a `CheckpointState` and generates a markdown summary of completed stages and accumulated context values. It is designed, implemented, and unit-tested. It is never called. `CodergenHandler.execute(node, _ctx, meta)` receives the full `PipelineContext` — the accumulated context map from all prior nodes — as its second argument, names it `_ctx` to signal it is unused, and writes `node.prompt` directly to disk without prepending any preamble. Every node that runs via `CodergenHandler` (which is also `RalphImplementHandler`) runs with only its static node-level prompt. It does not know what prior nodes completed, what they returned, or what context they deposited.

## Why It Matters

The `the-agentic-loop-is-a-graph` lens names observability and composability as the core properties that make graph-based pipelines valuable over a single opaque prompt. The context map — `checkpoint.context` — is the mechanism that makes nodes composable: a `ralph.meditate` node deposits `meditate.illuminations: 5` and `meditate.sessionId: abc`; a downstream `codergen` node should be able to reference these values when deciding how to proceed.

Without `buildPreamble` in the prompt path, this composability is structural but inert:

- A `codergen` node in loop iteration 3 has no more information than in iteration 1. The context accumulated by prior runs (`implement.success: false`, `implement.iterations: 47`) is stored in the checkpoint but invisible to the agent.
- A `ralph.implement` node following a `ralph.meditate` node doesn't know what the meditate session found. The illuminations count, session ID, and any other values meditate deposited are held in `context` but never surface to the implementer.
- `variableExpansionTransform` only substitutes `$goal` and `$project` — not arbitrary context keys like `$implement.success`. There is no other injection path. `buildPreamble` was the only designed mechanism for surfacing accumulated state to agents.

The evidence is in `src/attractor/tests/transforms.test.ts`: `buildPreamble` is tested with a checkpoint that includes `meditate.sessionId: abc` and `meditate.illuminations: 3`, and the test asserts the preamble contains "meditate." But no production code calls `buildPreamble`. The test validates the function; the function has no caller.

The `_ctx` underscore in `codergen.ts:13` is the critical tell. The interface requires it; the implementation ignores it. This is where the designed context pipeline terminates.

## Revised Implementation Steps

1. **Wire `buildPreamble` into `CodergenHandler.execute`.** Before writing `prompt.md`, prepend the preamble when fidelity is not `"full"`. The handler already has `logsRoot` in `meta`; add checkpoint loading, or pass the context directly:
   ```ts
   async execute(node: Node, ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
     const logsRoot = meta["logsRoot"] as string;
     const fidelity = (node.fidelity as string | undefined) ?? "compact";
     const cp = await loadCheckpoint(logsRoot);
     const preamble = cp ? buildPreamble(cp, fidelity) : "";
     const rawPrompt = node.prompt ?? node.label ?? "";
     const prompt = preamble + rawPrompt;
     // ...write prompt to file
   }
   ```
   Remove the `_` prefix from `ctx`. Use `ctx.values` for variable expansion if `variableExpansionTransform` is extended (step 3).

2. **Apply the same change to `ToolHandler` and any other handler that generates agent-facing prompts.** `WaitHumanHandler` prompts the human (not an agent), so it does not need preamble. `ConditionalHandler` evaluates conditions — whether it benefits from preamble depends on how condition evaluation works in practice.

3. **Extend `variableExpansionTransform` to include context keys.** Currently only `$goal` and `$project` are substituted. A node prompt like `"Build on the $meditate.illuminations insights from prior meditation"` requires that context keys be substitutable too. Add:
   ```ts
   if (n.prompt) {
     n.prompt = n.prompt
       .replace(/\$goal/g, goal)
       .replace(/\$project/g, project);
     for (const [k, v] of Object.entries(contextValues)) {
       n.prompt = n.prompt.replace(new RegExp(`\\$${k.replace(".", "\\.")}`, "g"), v);
     }
   }
   ```
   `pipelineRunCommand` already applies the transform before running — add `context` from the checkpoint as an additional input when resuming.

4. **Add a `CodergenHandler` test for context injection.** Write a test where a prior checkpoint has `context: { "meditate.result": "3 illuminations written" }` and the node prompt is `"Summarize: $meditate.result"`. Assert the written `prompt.md` contains the expanded value. This test is the missing link between the tested-but-unwired `buildPreamble` and production behavior.

5. **Audit the `_ctx` pattern across all handlers.** `CodergenHandler` is not the only file that may have received a context parameter and discarded it. Review `ToolHandler`, `RalphMeditateHandler`, `RalphScenariosHandler` for unused context parameters. Each unused `_ctx` is a handler that cannot participate in pipeline state accumulation.
