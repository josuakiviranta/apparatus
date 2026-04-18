---
date: 2026-04-18
status: open
description: The explain_removal node in illumination-to-implementation.dot fires a full Claude agent session on every invalid-illumination path, but has no produces= attribute — its output sets only agent.success/iterations in context, is never referenced by remove_gate, and is invisible to the human operator; the gate already shows the verifier's own $explanation unchanged.
---

## Core Idea

`explain_removal` in `pipelines/illumination-to-implementation.dot` fires a Claude agent session on every false-path traversal (`preferred_label=false`). Its prompt asks the agent to produce one human-readable sentence explaining why the illumination is invalid. But the node has no `produces=` attribute. The `AgentHandler` in `src/attractor/handlers/agent-handler.ts` only writes `agent.success`, `agent.iterations`, and `agent.sessionId` to `contextUpdates` when no `json_schema_file` is set. The agent's text output lands in `~/.ralph/runs/<runId>/explain_removal/` and nowhere else. The downstream `remove_gate` label is `"Remove this illumination?\n$illumination_path\n\n$explanation"` — it uses `$explanation` directly from the verifier, the same value `explain_removal` was asked to paraphrase. The node runs, produces output, and the pipeline discards it without the human ever seeing it.

## Why It Matters

Every invalid illumination costs one full `explain_removal` agent invocation: Claude reads the illumination file, reads the verifier's explanation, and produces one sentence — which is then shown to no one. The `remove_gate` display is identical whether `explain_removal` ran or not. On a pipeline heartbeat where the verifier consistently marks the same illumination invalid (a realistic scenario: illumination describes a partially-fixed bug, confusing the verifier), this node fires on every run.

The `proof-of-work-proof-of-usage` lens names the failure precisely: `explain_removal` looks like meaningful pipeline work — it has a name, a prompt, a log directory — but produces no verifiable usage. The node adds latency and cost while the human at the gate reads the verifier's own words anyway.

This is structurally distinct from T1100 (`remove_gate → No` has no state change) and T1300 (superseded node cluster). Those are routing problems. This is a data-flow problem: a node that computes a result no edge or label ever consumes.

## Revised Implementation Steps

1. **Verify the gap with one trace inspection.** Run the pipeline against a known-invalid illumination. After `explain_removal` completes, call `ralph pipeline trace <runId>` and confirm the context contains `agent.success=true` and `agent.iterations=1` but no key named `user_explanation` or similar. Confirm `remove_gate` shows the verifier's unmodified `$explanation`. This is a one-minute check before touching any code.

2. **Choose the fix: remove the node or wire its output.** Two options:
   - **Option A (simplest):** Delete `explain_removal` and connect `explain_removal -> remove_gate` directly as `verifier -> remove_gate [condition="preferred_label=false"]`. The verifier's `$explanation` is already shown in the gate. No agent invocation, no latency, identical user experience.
   - **Option B (intended behavior):** Add `produces="user_explanation"` to `explain_removal`. Change the `remove_gate` label to use `$user_explanation` instead of `$explanation`. Now the node's output is actually consumed — the gate shows a human-targeted sentence rather than the verifier's machine-targeted verdict text.

3. **Prefer Option A unless the verifier's `$explanation` is demonstrably machine-targeted.** Read three or four recent verifier outputs from trace files to judge the explanation quality. If the explanations are already clear prose (e.g., "The preflight variable check described in this illumination was shipped in commit abc123"), Option A is correct and Option B is over-engineering. If the verifier's explanations are dense with code paths and variable names, Option B's human-rewrite step has value — but then Option B requires the fix.

4. **Apply whichever fix as a single-line or two-line diff to `illumination-to-implementation.dot`.** Option A: remove the `explain_removal [...]` node declaration and change one edge. Option B: add `produces="user_explanation"` to `explain_removal`'s attribute list and change one string in `remove_gate`'s `label=`. Either change is a five-minute edit; the decision is the work.

5. **Check other agent nodes in `illumination-to-implementation.dot` for the same pattern.** `memory_writer` and `explainer` also have no `produces=` attribute. `memory_writer` is intentional — it writes a file to disk, not a context variable. `explainer`'s output is displayed live during the interactive pipeline session (the Ink renderer shows agent output). But audit all agent nodes without `produces=` and confirm each one's output has an intended consumer: either a downstream `$variable` reference, live display, or a file write. Any node whose output is consumed by nothing should be removed or wired.
