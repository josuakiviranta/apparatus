---
date: 2026-04-18
status: open
description: T2000's rm -f fix for delete_file and T2100's replacement of delete_file with archive_invalid are mutually exclusive — the pipeline will dispatch them as independent tasks, but implementing T2000 before T2100 wastes one full run on a node the next plan deletes, and both T2100 and T1100 must land as a single atomic .dot edit since they both re-route remove_gate.
---

## Core Idea

Three open illuminations target the same `remove_gate` region of `illumination-to-implementation.dot`, but two of them describe **incompatible implementations of the same node**. T2000 proposes making `delete_file` idempotent by changing `rm $illumination_path` to `rm -f $illumination_path`. T2100 proposes eliminating `delete_file` entirely and replacing it with an `archive_invalid` agent node. These are not complementary changes — T2100 deletes T2000's fix target. If the pipeline dispatches T2000 first, an implementer adds `-f` to the `rm` command; when T2100's plan then arrives, the implementer removes that same node. One full pipeline run — verifier (up to 50 subagents), explainer, approval gate, design writer, plan writer, implementation — was spent on a change that the subsequent run deletes.

T1100 (today's: `remove-gate-no-produces-no-state-change`) is independent of T2000 but **coupled with T2100** at the graph level. T2100 changes `remove_gate → Yes` (delete → archive). T1100 changes `remove_gate → No` (done → approval_gate). Both modify edges out of the same hexagon node. Implementing them in separate commits is safe — they touch different edges — but they represent a single logical correction to the gate's behavior. A `.dot` file that has T2120 applied but not T1100 has one correct exit and one loop-back to nothing.

## Why It Matters

The pipeline's `verifier` selects ONE open illumination per run with no ordering constraint. It globs `meditations/illuminations/*.md` and picks. With T2000 and T2100 both open, there is no guarantee of which runs first. The current working directory confirms that T2100 has NOT been applied to `illumination-to-implementation.dot` (the file still contains `delete_file [type="tool", tool_command="rm $illumination_path"]`), while the `mark-dispatched.mjs` hardening — a prerequisite for T2100's `archive_invalid` node — has already been implemented. Someone understood the T2100 prerequisite chain and started it; but T2000 is still open and eligible for dispatch on the next pipeline run.

If the pipeline picks T2000 before T2100:
1. A plan is written: "change `rm` to `rm -f` on line N of `illumination-to-implementation.dot`."
2. An implementer changes one character.
3. The next pipeline run picks T2100.
4. A new plan is written: "replace `delete_file` with `archive_invalid` in `illumination-to-implementation.dot`."
5. An implementer removes the node T2000 just touched.
6. Net result: two full pipeline runs, one wasted implementation, zero net difference in behavior.

T0400 (`backlog-is-a-dependency-graph-not-a-flat-queue`) named the general problem. This is the concrete instance: not just ordering, but **T2000's specific fix is made obsolete by T2100's implementation**. Archiving T2000 before any pipeline run reaches it costs nothing; dispatching it and then discarding the implementation costs two runs.

## Revised Implementation Steps

1. **Archive T2000 manually before the next pipeline run.** Call `mcp__illumination__mark_archived` with `filename="2026-04-17T2000-tool-command-has-no-idempotency-mechanism.md"` and `reason="Superseded by T2100: delete_file is being replaced with archive_invalid rather than made idempotent. T2000's broader audit guidance (inspect all tool_command= nodes in pipelines/) and the specs/commands.md note remain valid but can be incorporated directly into T2100's implementation plan without a separate dispatch."` This removes T2000 from the verifier's eligible pool immediately.

2. **Implement T2100 and T1100 as a single `.dot` edit, one commit.** The minimal diff to `illumination-to-implementation.dot` is:
   - Replace `delete_file [type="tool", tool_command="rm $illumination_path"]` with `archive_invalid [agent="implement", prompt="Call mcp__illumination__mark_archived with filename from $illumination_path (basename only) and reason: 'Invalid per verifier: $explanation'. Return the JSON result."]`
   - Change `remove_gate -> done [label="No"]` to `remove_gate -> approval_gate [label="No"]`
   - Change `remove_gate -> delete_file [label="Yes"]` to `remove_gate -> archive_invalid [label="Yes"]`
   - Change `delete_file -> done` to `archive_invalid -> done`
   - Update the `remove_gate` label to clarify both exits: `"Archive as invalid? / Yes → archive. No → override verifier, proceed to approval."`
   These four changes are the complete fix for both illuminations. Splitting them across two commits is possible but leaves `remove_gate` with one correct and one incorrect exit between commits.

3. **Incorporate T2000's broader audit into T2100's implementation plan.** T2000's surviving value is its recommendation to: (a) audit all `tool_command=` nodes in `pipelines/` for resume idempotency, and (b) add a note to `specs/commands.md` about `tool_command=` idempotency idioms (`rm -f`, `mkdir -p`, `git push`). These steps belong in T2100's plan as additional tasks, not as a separate dispatch. The `commit_push` node in `illumination-to-implementation.dot` is the main surviving `tool_command=` node and should be audited: `cd $project && git push origin $(git branch --show-current) || git push -u origin $(git branch --show-current)` is naturally idempotent (pushing identical commits is a no-op), so it requires no change.

4. **Implement T0900 (exit code) as a separate, independent commit to `src/cli/commands/pipeline.ts`.** T0900 does not touch the `.dot` file. It is orthogonal to the remove-gate cluster. However, T0900 must land before the remove-gate fixes can be smoke-tested reliably: while `ralph pipeline run` exits 0 on engine failure, a failed archive_invalid or failed remove_gate routing is indistinguishable from success at the process level. Implement T0900 first if the `.dot` changes will be validated by running the pipeline.

5. **Verify `mark-dispatched.mjs` idempotency covers the `archive_invalid` path.** The existing `mark-dispatched.mjs` already guards `status !== "open"` with exit 1. This means: if the pipeline runs `archive_invalid` (sets status to `archived`) and then crashes before the checkpoint advances past `mark_dispatched`, a `--resume` would try `mark_dispatched` on an archived illumination and get `status not open: archived` (exit 1). This is the correct failure mode — the checkpoint does not advance past `mark_dispatched`, so `--resume` re-runs `archive_invalid` (idempotent: `mark_archived` on an already-archived file should be a no-op), then `mark_dispatched` again. Confirm `mcp__illumination__mark_archived` exits 0 when called on an already-archived file; if not, add idempotency handling before deploying T2100.
