---
date: 2026-04-18
status: open
description: Eight illuminations have fully analyzed the false-path cluster, but their individual implementation steps conflict — the resolution is a single unified commit (one .dot edit + one new script), preceded by manual archival of T2000 and T1700, which the pipeline cannot perform for itself.
---

## Core Idea

Eight illuminations written on 2026-04-18 all target the same five-node false path in `illumination-to-implementation.dot`. Each one refines the previous: T1700 proposed an atomic diff; T1900 corrected its node identity (reuse `mark_archived`, don't create `archive_invalid`); T2300 corrected its node type (script, not agent); T2100 identified the verifier's topological blind spot that let T1700's error through. The analysis is saturated. The implementation is a single commit: delete `explain_removal`, re-route three edges, delete `delete_file`, convert `mark_archived` to `type="tool"`, add a 30-line `mark-archived.mjs` script. This resolves T1100, T1500, T1900, and T2300 in one diff. T0900 and T2100 are orthogonal and ship separately.

The pipeline cannot execute this sequence for itself. T2000 and T1700 are still open and eligible for dispatch. T2000 proposes hardening a node the unified diff deletes. T1700 proposes creating `archive_invalid` as an agent node — contradicting T2300's script prescription and T1900's node identity fix. If the verifier picks either before the archival pass, it will generate a plan the unified diff immediately renders obsolete.

## Why It Matters

The verifier selects one open illumination per run with no ordering constraint. With T2000 and T1700 both open, a normal pipeline run will generate a plan for superseded work. T2000's plan: "change `rm` to `rm -f` on line N." T1700's plan: "add `archive_invalid [agent="implement", ...]` node." Both plans describe nodes the unified diff deletes. The implementer commits the change. The next run then lands a plan that removes what the previous plan added. Two full pipeline cycles — verifier (up to 50 subagents), explainer, approval, design, plan, implement, review, push — consumed to achieve zero net delta.

The deeper structural fact: when the meditate session focuses on the pipeline itself rather than `src/`, the output illuminations are mutually dependent. Illuminations about `src/cli/commands/` are independent — fixing logging in one file does not conflict with adding a new command. Illuminations about `illumination-to-implementation.dot` are not — they all edit the same five nodes, and their edits are not commutative. The dispatch pipeline has no model for this. Only the operator can break the cycle before it wastes runs.

T2300's `mark-archived.mjs` step and T1900's re-routing step also converge on the same solution from different directions. T2300 says "create `archive_invalid` as a script node." T1900 says "route to the existing `mark_archived` node." Both are correct — the resolution is: adopt T1900's node identity (keep `mark_archived`), adopt T2300's node type (convert it to `type="tool"`, add the script). Together they are one atomic decision, not a sequence of two dispatches.

## Revised Implementation Steps

1. **Archive T2000 and T1700 before any pipeline run.** T2000 (`2026-04-17T2000-tool-command-has-no-idempotency-mechanism.md`): superseded — `delete_file` is being deleted, not hardened. T1700 (`2026-04-18T1700-false-path-is-a-first-class-branch-not-an-error-handler.md`): superseded — its atomic diff proposes `archive_invalid [agent="implement"]`, which both T1900 and T2300 correct. Archive both with a reason citing T1900 and T2300. This removes them from the verifier's pool immediately.

2. **Implement T0900 first, as a standalone commit to `src/cli/commands/pipeline.ts`.** Set `process.exitCode = 1` after engine failure (use `let pipelineFailed = false` inside the `try` block, set it when `result.status !== "success"`, emit in `finally` after `await waitUntilExit()`). This must land before the unified `.dot` edit is smoke-tested: while the pipeline exits 0 on engine failure, a broken `mark_archived` script invocation is indistinguishable from success at the process level.

3. **Apply the unified `.dot` edit as one commit** (resolves T1100, T1500, T1900, T2300):
   - Delete the `explain_removal` node declaration entirely.
   - Change `verifier → explain_removal [condition="preferred_label=false"]` to `verifier → remove_gate [condition="preferred_label=false"]` — one edge, saves one full agent invocation per rejection.
   - Change `remove_gate → done [label="No"]` to `remove_gate → approval_gate [label="No"]` (T1100 — human override proceeds to a stateful decision, not a silent drop).
   - Change `remove_gate → delete_file [label="Yes"]` to `remove_gate → mark_archived [label="Yes"]` (T1900 — reuse the existing node, do not add `archive_invalid`).
   - Delete the `delete_file` node declaration — it is now unreachable.
   - Convert the existing `mark_archived` node from `agent="implement", prompt="Call mcp__illumination__mark_archived..."` to `type="tool", script_file="scripts/mark-archived.mjs", script_args="$illumination_path $summary"` (T2300 — one deterministic function call needs no LLM round-trip).
   - Update `remove_gate`'s label to reflect both exits: `"Archive as invalid?\nYes → archive. No → override verifier, proceed to approval.\n$illumination_path\n\n$explanation"`.

4. **Create `pipelines/scripts/mark-archived.mjs`** alongside the `.dot` edit (same commit). Model it exactly on `mark-dispatched.mjs`. Args: `<illumination-path> <reason>`. Idempotency guard: if status is already `archived`, look for the file in the `illuminations/archive/` subdirectory — if present, return `{ marked_archived: "<path>", idempotent: true }` and exit 0. Add a test following `pipelines/scripts/tests/mark-dispatched.test.mjs`: run the script twice against the same fixture, confirm the second call returns `idempotent: true` and exits 0.

5. **Apply the verifier scope fix as a second, separate commit** (T2100): edit the `verifier` node's prompt in `illumination-to-implementation.dot` to add `pipelines/*.dot` as a third scope after `src/` and `specs/*.md`. Add the topological accuracy criterion: "If the illumination proposes a pipeline graph change, no proposed new node already exists under a different name." Validate the fix by running the updated pipeline against T2100 — the verifier should now find `mark_archived` in the graph and return `preferred_label=false`, since the node T2100 proposed as `archive_invalid` already exists.

6. **Archive T1100, T1500, T1300, T1900, T2300** after step 3 lands — they are implemented. Archive T2100 after step 5 lands. Archive T1300 (it is a meta-observation, not an implementation target — its value was in naming the supersession; that supersession is now resolved).
