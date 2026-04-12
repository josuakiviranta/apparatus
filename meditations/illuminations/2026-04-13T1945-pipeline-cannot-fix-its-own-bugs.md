---
date: 2026-04-11
description: The illumination-to-plan pipeline has four documented, actionable bugs and has never completed a run — it cannot process its own illuminations because it is the subject of them; the unblocking order is T1845 → T1500 → T1730 → T1620, all implementable directly without design work.
---

## Core Idea

The `illumination-to-plan` pipeline is in a bootstrap deadlock: it is both the instrument for converting illuminations into plans and the subject of four illuminations written on 2026-04-13. Each of those illuminations includes a complete, step-level fix. None have a corresponding plan file. The pipeline cannot process its own bugs because the bugs prevent it from running. The only way out is to implement the fixes directly — bypassing the pipeline — so the pipeline can eventually run itself.

This is not a design problem. Every fix is already specified. It is a sequencing problem.

## Why It Matters

The pipeline has never completed a successful run. The memory file `memory/2026-04-13-illumination-pipeline-session.md` confirms: after the JSON constraint fix in 0.0.49, the verifier still fails with `Unexpected end of JSON input`. The root cause — identified in T1730 — is that the verifier node combines deep agentic research (50 subagents) with structured JSON output in a single session. These two requirements are architecturally incompatible. The fix is a node split, not a prompt tweak.

The other three bugs compound this. T1845 (`approval_gate → delete_agent [label="Decline"]`) means a user who reaches the gate and chooses not to proceed loses the illumination permanently — destroying what the verifier just spent 50 subagents confirming is valid. T1500 means a scheduled headless run auto-approves deletions silently. T1620 means post-chat pipeline output goes dark after the chat node exits, hiding whether downstream nodes ran at all.

The DOT file at `pipelines/illumination-to-plan.dot` still contains the unmodified Decline edge. The `src/cli/components/ChatUI.tsx` still uses `<Static items={history}>`. The verifier node is still a single node. None of the T1730 steps have been actioned.

The meta-meditation "Every Action Needs an Escape" names the T1845 failure precisely: every state the user can reach needs a way out that doesn't destroy their work. "The Agentic Loop Is a Graph" names what's at stake: the graph's value is observability and resumability — but a graph that destroys verified inputs on the "decline" path undermines the framework's fundamental promise.

## Revised Implementation Steps

1. **Fix T1845 first.** In `pipelines/illumination-to-plan.dot`, change `approval_gate -> delete_agent [label="Decline"]` to `approval_gate -> done [label="Skip"]`. This is one line. It makes the pipeline safe for human use immediately — a user who defers will not lose a verified illumination. Also update the `approval_gate` label to list options: `Approve / Skip / Chat`.

2. **Fix T1500 next.** In the same DOT file, reorder `remove_gate` edges so `[label="No"]` precedes `[label="Yes"]`, and reorder `approval_gate` edges so `[label="Skip"]` precedes `[label="Approve"]`. Add `headless_safe=false` to the graph declaration. In `src/cli/commands/heartbeat.ts`, after the graph parse, check `headlessSafe` and warn before registering a headless-unsafe pipeline. This makes the safe default safe and prevents silent autonomous deletion.

3. **Fix T1730.** Split the `verifier` node into `researcher` (no schema, up to 50 subagents, writes findings to `meditations/.triage/research-notes.md`) and `verifier_summarizer` (json_schema_file set, reads only from research-notes.md, no subagents). Update edges: `start -> researcher -> verifier_summarizer`. All downstream edges from old `verifier` hang off `verifier_summarizer`. This unblocks the pipeline's primary failure mode. Also move the `writeFileSync(nodeDir/raw-output.txt)` call in `src/attractor/handlers/agent-handler.ts` to before the empty-output guard, so every future failure is inspectable.

4. **Fix T1620.** In `src/cli/components/ChatUI.tsx`, replace `<Static items={history}>` with a plain `<Box flexDirection="column">` wrapping `history.map((turn, i) => <TurnView key={i} turn={turn} />)`. Then write an integration test in `src/cli/tests/pipeline-interactive.test.tsx` that does NOT mock ChatUI and asserts post-chat lines appear in `lastFrame()`. The existing mock comment in that test explains why the real component was excluded — after this fix, update the comment to document that the real component now works.

5. **Run the pipeline against itself.** After steps 1–4 are committed, run `ralph pipeline run illumination-to-plan.dot` against the project. The researcher node will run long; the verifier_summarizer will be fast. The first successful run validates the full fix set and activates the pipeline for future sessions. The four illuminations that described these bugs now become the first inputs it can process.
