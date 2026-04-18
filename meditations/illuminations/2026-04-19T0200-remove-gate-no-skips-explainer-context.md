---
date: 2026-04-18
status: open
description: T1900T0000's unified diff routes `remove_gate [No]` directly to `approval_gate`, bypassing `explainer` — so the human who overrides the verifier sees only the verifier's rejection rationale at the approval gate, not the concrete before/after context the `explainer` produces for every normal true-path approval.
---

## Core Idea

T1900T0000's unified diff changes `remove_gate → done [label="No"]` to `remove_gate → approval_gate [label="No"]`. The intent is correct: when a human disagrees with the verifier's rejection, the illumination should enter the normal approval flow rather than silently dying. But the edge goes directly to `approval_gate`, skipping the `explainer` node. On the true path, `explainer` runs before `approval_gate` and produces four concrete sections: currently-implemented state, what-will-change (with before/after code blocks), why-it-matters, and affected files. That output is what makes `approval_gate` a meaningful decision point. On the override path, the human sees: the verifier's rejection summary (`$summary`) and the verifier's invalidity reasoning (`$explanation`) — the same context that persuaded them to say "No" at `remove_gate` in the first place. The human is asked to approve implementation without having seen what the implementation would actually look like.

The `explainer` node in `illumination-to-implementation.dot` does not assume `preferred_label=true` context. Its prompt reads the illumination file and spawns subagents to gather codebase context. It would produce identical, useful before/after output whether it was reached from `verifier [true]` or from `remove_gate [No]`. DOT graphs accept multiple in-edges: `remove_gate → explainer [label="No"]` is a single-line change, and the existing `explainer → approval_gate` edge already handles the rest.

## Why It Matters

The override path is exactly the case where the approval gate decision is hardest. On the true path, the verifier certified the illumination valid — the human is approving something that passed automated review. On the override path, the verifier rejected the illumination — the human is approving something that failed automated review. The stakes of the approval decision are higher when the human and the verifier disagree, yet the proposed routing gives the human less decision context at that moment.

The concrete gap: a human at `remove_gate` who disagrees with the verifier has seen `explain_removal`'s single sentence explaining invalidity (e.g., "This proposes adding `mark_archived` to the false path, but the node already exists on the true path's decline branch"). If they say "No" and reach `approval_gate` directly, they're shown `$illumination_path` and `$summary` — the verifier's terse summary of the illumination's topic. They have not seen: what the current codebase actually does at the relevant files, what the change would produce, what the affected file list is. The `explainer` provides all of this. Without it, the approval gate is a confirmation box for a decision the human already made at `remove_gate`, not a structured review step.

This is a one-line correction to T1900T0000's unified diff. If applied after T1900T0000 ships, it is a two-line patch to `illumination-to-implementation.dot`. It does not affect the `mark_archived` conversion, the `delete_file` removal, or the verifier scope fix. It is orthogonal to all other open false-path work.

## Revised Implementation Steps

1. **Verify the current DOT before applying.** After T1900T0000's unified diff lands, read `illumination-to-implementation.dot` and confirm the edge reads `remove_gate -> approval_gate [label="No"]`. If T1900T0000 has not yet landed, this fix should be bundled into the unified diff in step 3 of T1900T0000 as a sixth bullet: "Change `remove_gate → done [label='No']` to `remove_gate → explainer [label='No']`" (not to `approval_gate`).

2. **Apply the edge correction.** In `illumination-to-implementation.dot`, change:
   ```dot
   remove_gate -> approval_gate [label="No"]
   ```
   to:
   ```dot
   remove_gate -> explainer   [label="No"]
   ```
   The `explainer -> approval_gate` edge already exists and handles the rest. No new nodes, no new edges beyond this one change.

3. **Update `remove_gate`'s label to reflect the corrected flow.** The label describes what the gate decides. After the fix, "No" means "don't archive — explain and review," not "don't archive — proceed to approval." A label like `"Archive as invalid?\nYes → archive\nNo → explain and proceed to approval\n\n$illumination_path\n$explanation"` accurately reflects both exits.

4. **Smoke-test the override path.** Identify an illumination the verifier marks `preferred_label=false` and manually say "No" at `remove_gate`. Confirm the session enters the `explainer` node, produces a before/after block, and then arrives at `approval_gate` with the explainer output visible. This path has never been exercised in production — the prior routing went straight to `done`, which no one would have approved through.

5. **Archive this illumination after step 2 lands.** This is a single-edge correction to a document change, not an `src/` fix — no plan, no design doc, no TDD cycle needed. The diff is one line in one `.dot` file.
