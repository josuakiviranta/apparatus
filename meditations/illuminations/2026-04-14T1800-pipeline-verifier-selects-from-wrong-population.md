---
date: 2026-04-13
status: archived
description: The illumination-to-plan.dot verifier globs all files in meditations/illuminations/ including dispatched ones, creating two failure modes on the second pipeline run: hard crash when mark_dispatched rejects a non-open status, or silent data loss when mark_archived destroys a dispatched record.
archived_at: 2026-04-25
reason: Verifier prompt already filters status:open at pipelines/illumination-to-plan.dot:8
---

## Core Idea

The `verifier` node in `illumination-to-plan.dot` uses `glob meditations/illuminations/*.md` with no status filtering. Dispatched illuminations remain in this directory — `markArchived` moves files to `archive/`, but `markDispatched` only mutates frontmatter in place. Once any illumination has been dispatched, the verifier's input pool contains both open and dispatched files. On the second pipeline run, the verifier may select a dispatched illumination. Two distinct failures follow depending on the verification outcome: if the code condition is still present (verification passes), the pipeline proceeds to `mark_dispatched`, which rejects non-open status and returns `{ success: false, error: "Cannot mark as dispatched: current status is dispatched" }` — a hard failure at the final lifecycle node after all preceding compute has been spent. If the code condition appears resolved (verification fails), the pipeline routes to `remove_gate → mark_archived`, which accepts any non-archived status and succeeds — silently destroying the dispatch record and moving the file to `archive/`. T1100 named this same root cause in the backpressure guard; the pipeline's failure modes are worse: one is a crash, the other is quiet state corruption.

## Why It Matters

The idempotency lens makes the failure concrete. Run `ralph pipeline run illumination-to-plan.dot .` once: an illumination moves from open to dispatched, a design doc is written, a plan is written. Run it again the next morning: the verifier picks the same dispatched illumination (it is still in the directory, likely the largest or most recent file), the verification agent finds the code condition still present (nothing has been implemented yet), `preferred_label: true` is returned, `explainer` and `approval_gate` run, the user approves, `design_writer` writes a duplicate design doc, `mark_dispatched` fails. The pipeline has consumed one full agent execution cycle — verifier with 50 subagents, explainer, design_writer — and crashed at the state transition. The user sees an error from the final node and has no explanation for why the pipeline aborted after apparent success.

The second failure mode is quieter and more damaging. If a dispatched illumination describes a condition that no longer exists in the codebase (it was fixed between runs), verification returns `preferred_label: false`. The `explain_removal → remove_gate` path activates. The user is shown a plausible explanation. If they click "Yes" — or if the gate is eventually automated — `mark_archived` runs and succeeds. The illumination's dispatch record disappears. The plan it was dispatched with (`plan_path` in frontmatter) is now orphaned with no illumination pointing to it. T0100 named "dispatched is a dead-end state" as a concern; this is the path by which dispatched silently becomes a worse dead end — archival — for the wrong reason.

The fix requires status-aware selection at the verifier. This connects to T1700: the verifier uses `agent="implement"` which has `mcp: []`, so `list_illuminations(status=open)` is unavailable via MCP. Without T1700's MCP fix, the verifier must do inline frontmatter parsing — fragile and O(n). With T1700's fix applied, the verifier prompt becomes a one-line change.

## Revised Implementation Steps

1. **Apply T1700's MCP fix first.** Add the illumination MCP server to `implement.md`'s `mcp:` block and add `list_illuminations` to its `tools:` whitelist. This is a prerequisite: without it, the verifier cannot call `list_illuminations(status=open)` and must fall back to file-level parsing.

2. **Update the verifier prompt in `illumination-to-plan.dot`.** Replace steps 1–3:
   ```
   1. Call list_illuminations with status=open to get only unprocessed illuminations.
   2. If the result is "No illuminations found.", return preferred_label: empty, illumination_path: empty, summary: No open illuminations, explanation: All illuminations have been dispatched or the directory is empty.
   3. Pick ONE illumination from the open list. Read it with read_file.
   ```
   This is a three-line prompt edit. The rest of the verifier prompt (steps 4–5, verification criteria, rules) is unchanged.

3. **Add a guard in `mark_dispatched`'s pipeline node as a second layer.** Change the `mark_dispatched` prompt to: "Call `mcp__illumination__mark_dispatched` ... If the result contains `success: false`, output the error and stop — do not proceed to plan_writer." This turns the silent failure into an explicit halt with a readable error, so even if a dispatched illumination slips through the verifier, the pipeline fails loudly at the transition rather than silently.

4. **Add a smoke test for the second-run case.** In `src/cli/tests/pipeline-headless.test.ts` or a new `illumination-to-plan.test.ts`: create a fixture with one open illumination and one dispatched illumination. Run the pipeline. Assert that the verifier's structured output always references an open-status illumination. This test will fail before the fix (verifier may select either) and pass after.

5. **Verify with the real corpus before the first pipeline run.** Before invoking `ralph pipeline run illumination-to-plan.dot .` for the first time: confirm the verifier prompt has been updated. The current corpus has 17 open illuminations and 0 dispatched — so the first run is safe regardless. The bug is invisible until a dispatched file exists. Fixing it before the first run ensures the pipeline is idempotent from the start.
