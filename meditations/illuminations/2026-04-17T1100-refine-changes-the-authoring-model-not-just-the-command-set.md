---
date: 2026-04-17
status: dispatched
description: pipeline refine shifted pipeline authoring from a one-shot creation event to a repeatable iteration loop by applying exemplar injection — injecting the current .dot verbatim into the session trigger — which means agent assistance is now available at every meaningful change, not only at first creation.
dispatched_at: 2026-04-17
plan_path: docs/superpowers/plans/2026-04-17-refine-run-history-and-failure-tip.md
---

## Core Idea

Before `ralph pipeline refine`, agent-assisted pipeline authoring was a creation event: it fired once, produced a `.dot` file, and ended. Every subsequent change — adding a branch after a failure, changing an agent name, tuning a retry condition — happened through hand-editing DOT syntax with no agent guidance and no protection against silent routing errors. `refine` changed this not by adding a fundamentally different mechanism but by applying the same two-phase Claude session pattern with one behavioral inversion: read the existing file, inject it verbatim into the session trigger, and frame the session as "targeted edits, not a redesign from scratch." The session enters the conversation knowing the current graph topology. The human's first message can be immediately productive.

The "preserve node IDs and edge labels" constraint in the trigger (`pipeline.ts:pipelineRefineCommand`) is load-bearing. Without it, refine would be indistinguishable from delete-and-recreate. It's the constraint that makes agent-assisted iteration *safe to run repeatedly* — the agent is explicitly instructed to produce a delta, not a new graph. This is the difference between a tool that accumulates design knowledge and one that resets it.

## Why It Matters

The prior authoring model was asymmetric: expensive and agent-assisted for creation, cheap and blind for everything after. Teams that invested in ralph pipelines — the ones with 5–10 pipelines after six months — were spending most of their time in the blind phase. `refine` closes this asymmetry: agent assistance is now available at the same cost for any meaningful iteration.

Two structural observations from the implementation:

First, `composeCreatePrompt()` is shared verbatim between `create` and `refine`. This means `refine` gets project-local agent awareness (`buildAgentSection` reads `.ralph/agents/`) in addition to the current graph. The authoring agent knows both the topology it's editing *and* the agents available in the project. This is the right context window for a refinement conversation.

Second, the two-phase session pattern (`spawn → collect sessionId → spawnSync resume`) is now triplicated across `plan.ts`, `pipelineCreateCommand`, and `pipelineRefineCommand`. The design spec explicitly deferred extraction to a third caller. Refine is that third caller — the extraction signal has arrived.

## Revised Implementation Steps

1. **Extract `runTwoPhaseClaudeSession()` into `src/cli/lib/session.ts`.** The pattern — non-interactive kickoff with `--output-format stream-json` to collect a session ID, then interactive `spawnSync` resume — is now duplicated three times with identical logic and identical signal handling. Extract it. Both `pipelineCreateCommand` and `pipelineRefineCommand` in `pipeline.ts` and the equivalent in `plan.ts` become thin callers. This is the only non-trivial refactor the refine work surfaced.

2. **Inject recent run traces into the `refine` trigger.** The current trigger gives the agent the graph but not its history: what failures motivated the current structure, what was tried and discarded, what the last three run outcomes were. The JSONL tracer already writes this to `~/.ralph/runs/<slug>/pipeline.jsonl`. A `buildRunHistorySection(graph.name)` function (parallel to `buildAgentSection`) could read the last N run summaries and append them to the trigger as `## Recent run outcomes`. The refine agent would then know *why* certain edges exist, not just that they do.

3. **Add a graph-diff check after a refine session.** `pipelineValidateCommand` checks structure — it does not detect whether existing edge labels were silently renamed. The most dangerous outcome of a refine session is an edge label changing from `"fail"` to `"error"` (or being dropped) when downstream routing still expects `"fail"`. Parse the before-snapshot (read before session launch) and the after-snapshot (read after clean exit) and warn on any edge label that changed or disappeared. This is a refine-specific concern; `create` has no before-state to compare against.

4. **Surface `refine` as a post-failure suggestion in `pipelineRunCommand`.** Today, a developer whose pipeline ends in failure must know `refine` exists and type it manually. The most natural discovery point is a failed pipeline run — the moment when the developer is already thinking about what to change. After printing the failure outcome, append: `Tip: ralph pipeline refine <name> to improve this pipeline with agent assistance.` One line. No flag, no config, no opt-in.
