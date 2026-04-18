---
date: 2026-04-18
status: open
description: All six open illuminations targeting illumination-to-implementation.dot cluster exclusively on the false path (preferred_label=false), which was designed as a minimal exit handler rather than a first-class branch — every single one of its bugs stems from this original design assumption, and dispatching them independently will generate competing partial implementations of the same five-node region.
---

## Core Idea

Every open bug in `illumination-to-implementation.dot` lives on the false path. The true path (`verifier → explainer → approval_gate → design_writer → plan_writer → mark_dispatched → implement → review_gate → commit_push → memory_writer → done`) has zero open illuminations. The false path (`verifier → explain_removal → remove_gate → delete_file/done`) has six: T0900 (exit code), T1100 (No exit produces no state change), T1300 (T2000 superseded by T2100), T1500 (explain_removal output is consumed by nothing), T2000 (rm lacks idempotency), T2100 (delete instead of archive). This is not coincidence. The false path was built as a disposal exit after the main workflow was designed, and it shows: no named outputs, no state transitions, no audit trail, two competing implementations of the same node. The verifier has no awareness of this clustering — it selects one open illumination per run from the full pool, and will dispatch these as six independent pipeline runs.

## Why It Matters

The false path is not an edge case. The verifier evaluates illuminations against current code using up to 50 subagents — it will return `preferred_label=false` for any illumination that describes a partially-fixed bug, a superseded pattern, or a misread source file. These are ordinary outputs of the meditate session. Treating them as exceptional was a design mistake that is now visible in the open-illumination backlog: six bugs, all in five nodes.

The dispatching hazard is concrete. T1500 (remove explain_removal) and T1100 (re-route remove_gate→No) and T2100 (replace delete_file with archive_invalid) all edit the same five-node cluster in `illumination-to-implementation.dot`. If the pipeline dispatches them in three separate runs — which is its default behavior — each run writes a plan, spawns an implementer, and commits a diff. The first diff is immediately partial. The second diff lands on top of the first, potentially conflicting. The third may find that the node it was told to modify was renamed or removed by run two. Three full pipeline cycles (verifier, explainer, approval, design, plan, implement, review, push, memory) spent on what should be one atomic edit.

The `idempotency-run-it-twice` lens names the underlying risk differently: a pipeline that self-modifies must be safe to run repeatedly on the same structural target. Right now it is not — each run leaves the false path in a different inconsistent state.

## Revised Implementation Steps

1. **Archive T2000 immediately, before the next pipeline run.** Call `mcp__illumination__mark_archived` on `2026-04-17T2000-tool-command-has-no-idempotency-mechanism.md` with reason: "Superseded by T2100. The `delete_file` node T2000 proposed hardening is being replaced wholesale by `archive_invalid`. T2000's broader audit of `tool_command=` idempotency across `pipelines/` should be folded into T2100's implementation plan as an additional audit step." This removes T2000 from the verifier's eligible pool immediately and prevents one wasted dispatch.

2. **Treat T1100, T1500, and T2100 as a single atomic `.dot` edit, not three dispatches.** The minimal coherent diff to `illumination-to-implementation.dot` is:
   - Remove `explain_removal [agent="implement", ...]` entirely (T1500 — dead computation, verifier's `$explanation` is already shown at the gate unchanged).
   - Change the routing edge from `verifier -> explain_removal [condition="preferred_label=false"]` to `verifier -> remove_gate [condition="preferred_label=false"]` (saves one full agent invocation on every rejection path).
   - Change `remove_gate -> done [label="No"]` to `remove_gate -> approval_gate [label="No"]` (T1100 — human override proceeds to stateful decision).
   - Replace `delete_file [type="tool", tool_command="rm $illumination_path"]` with `archive_invalid [agent="implement", prompt="Call mcp__illumination__mark_archived with filename from $illumination_path (basename only) and reason: 'Invalid per verifier: $explanation'. Return the JSON result."]` (T2100 — archive not delete).
   - Update edges: `remove_gate -> archive_invalid [label="Yes"]` and `archive_invalid -> done`.
   - Update `remove_gate` label to: `"Archive as invalid? Yes → archive. No → override verifier, proceed to approval.\n$illumination_path\n\n$explanation"`.
   This is five line-level changes to one file. It resolves T1100, T1500, and T2100 simultaneously. Archive those three illuminations as a batch after the diff lands.

3. **Dispatch T0900 as a separate, independent commit to `src/cli/commands/pipeline.ts`.** T0900 (exit code) does not touch the `.dot` file and is orthogonal to the false-path structural changes. It should land first: the false-path changes will route more traffic through `archive_invalid`, and a silent exit-0 on engine failure will mask any `archive_invalid` defects during testing. Fix T0900 before merging the `.dot` changes.

4. **Confirm `mcp__illumination__mark_archived` is idempotent before deploying `archive_invalid`.** The new `archive_invalid` node will appear on `--resume` paths. If archival completes but the engine crashes before the checkpoint advances past it, a resume will call `mark_archived` a second time on an already-archived file. If it returns non-zero, the resume fails at the wrong node. Test: call `mark_archived` on a file that is already archived and verify it exits 0 with an idempotent response (equivalent to `mark-dispatched.mjs`'s `idempotent: true` pattern).

5. **Redesign the false path with the same discipline as the true path.** After the immediate fixes above, the false path will be: `verifier → remove_gate → [Yes: archive_invalid → done] [No: approval_gate → ...]`. The `approval_gate` branches (Approve, Decline, Chat) already implement stateful, auditable exits. The false path now shares the same exit infrastructure as the true path. Future improvements to `approval_gate` (new branch labels, refined prompts) apply automatically to both paths. This is the structural correction: the false path is not a disposal chute — it is a triage workflow that deserves the same state management as the acceptance workflow.
