---
date: 2026-04-09
description: PROMPT_pipeline_create.md teaches pipeline syntax but misdefines goal_gate and omits loop_restart entirely — so Claude will author pipelines that lack or misuse the two features that enforce pipeline correctness.
---

## Core Idea

`PROMPT_pipeline_create.md` is the documentation Claude consumes when authoring pipelines via `ralph pipeline create`. It covers syntax correctly but misdescribes `goal_gate` and omits `loop_restart` entirely. `goal_gate=true` is described as "enforce goal completion before exiting the node" — which reads as a per-node lifecycle constraint. The actual semantics are a pipeline-level invariant: this node must appear in `completedNodes` before the exit node may run. A pipeline author following the description will apply `goal_gate` to nodes already on the mandatory path, where it is redundant, rather than to nodes that might be skipped by alternate routing, where it is the only enforcement mechanism.

## Why It Matters

The `comprehensive-docs-are-agent-fuel` lens states directly: docs that are too sparse leave the agent guessing. The authoring prompt is the only context Claude has when writing a pipeline. Defects in the prompt propagate into every pipeline Claude authors.

The misattribution matters structurally. `goal_gate=true` is useful precisely when a node might be bypassed — for example, a `tests` node on an alternate branch the pipeline could skip. If Claude reads "enforce goal completion before exiting the node," it will treat `goal_gate` as a modifier for nodes that already execute, not as a safety net for nodes that might not. The reference example in the prompt (`src/cli/prompts/PROMPT_pipeline_create.md`) uses no `goal_gate` anywhere, so Claude has zero grounded examples of the correct pattern.

`loop_restart` is entirely absent from the prompt. It is a supported attribute in `types.ts` on both nodes and edges, and the engine handles it in `engine.ts` at the "Advance" step. But a pipeline created via `ralph pipeline create` will never contain a `loop_restart` edge because Claude has no documentation to draw on. More subtly: `loop_restart=true` on an edge causes the engine to ignore `nextEdge.to` entirely — the edge destination is a phantom required only to pass graph validation. An author who discovers `loop_restart` through code exploration has no guidance on how to point the edge.

Three immediate consequences:
1. Pipelines authored via `create` will never use `goal_gate` correctly (wrong description, no example).
2. Pipelines that need loop-back behavior will not use `loop_restart` (not in prompt).
3. A developer adding `loop_restart` to a hand-authored pipeline will write `work -> start [loop_restart=true]` and hit a validation error ("Start node must not have incoming edges") with no guidance on the correct workaround.

## Revised Implementation Steps

1. **Fix the `goal_gate` description in `PROMPT_pipeline_create.md`.** Replace "enforce goal completion before exiting the node" with: "mark this node as required for pipeline exit — the pipeline cannot reach the exit node until this node has been completed, regardless of which path was taken." Move the attribute from the generic "All nodes" table into a dedicated **Goal gates** section that explains the invariant: add `goal_gate=true` to nodes that might be skipped by alternate routing but must not be.

2. **Add a `goal_gate` example to the reference pipeline.** Extend the existing annotated example to include a `goal_gate=true` node on an alternate branch — one that the main path could bypass — so Claude sees the feature used in its only useful context. One new node and two edge lines suffices.

3. **Document `loop_restart` in the prompt.** Add a short **Loop restart** section explaining: `loop_restart=true` on an edge resets `completedNodes`, `nodeRetries`, and context, then returns to the start node. The edge target is arbitrary but must be a declared node (the engine ignores it). Provide a concrete pattern — `work -> loop_sentinel [loop_restart=true]` with `loop_sentinel` as a dedicated phantom node — so authors know the correct workaround for the no-incoming-edges constraint on start.

4. **Add a `loop_restart` validation hint in `validateGraph`.** When an edge with `loop_restart=true` points to the start node, emit a warning (not an error): `"loop_restart edge should not target start node directly; use a sentinel node instead."` This surfaces the constraint before a confused author runs the pipeline.

5. **Add a `loop_restart` engine test.** The existing `engine.test.ts` has no test for loop restart. Add one: a pipeline with `work -> sentinel [loop_restart=true]` where `work` is visited twice (once per loop pass). Assert `completedNodes` after two passes contains `start` and `work` — not `start`, `work`, `start`, `work` (which is what the bag behavior in the 0900 illumination would produce). This test will fail until the 0900 deduplication fix is also applied, making the dependency between the two bugs explicit.
