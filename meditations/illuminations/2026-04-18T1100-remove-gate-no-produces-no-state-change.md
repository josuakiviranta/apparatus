---
date: 2026-04-18
status: open
description: When the user says "No" at remove_gate (refusing deletion of an invalid illumination), the pipeline routes to done with zero state change — leaving the illumination open and permanently eligible for re-evaluation on every future pipeline run.
---

## Core Idea

In `pipelines/illumination-to-implementation.dot`, when the verifier finds an illumination invalid (`preferred_label=false`), the pipeline shows the user a `remove_gate`: "Remove this illumination?" If the user says "No", the edge routes to `done`. The illumination's status remains `open`. Nothing was written, nothing transitioned. On the next pipeline run the verifier finds the same open illumination, evaluates it invalid again, and presents the same gate. The user must answer the same question with no persistent outcome — indefinitely.

The `remove_gate → Yes` path has a defined outcome (currently `delete_file`, proposed as `archive_invalid` by illumination T2100). The `remove_gate → No` path produces a state identical to the pre-run state. It is an escape that exits into the state it came from.

## Why It Matters

The pipeline's state machine defines four terminal states: `open`, `dispatched`, `implemented`, `archived`. Every meaningful decision made about an illumination is supposed to produce a state transition. `remove_gate → No` is the only human decision in the entire pipeline that does not. A human has exercised judgment — "this illumination is worth keeping" — and the system has no way to record or honor that judgment.

The behavioral consequence is concrete. With the current corpus of 4 open illuminations, the verifier selects one per run. If any of them is one the verifier consistently marks invalid (perhaps the underlying code is partially fixed, confusing the verifier), the developer will answer "No" once, then again the next run, and again. Each "No" costs a full verifier invocation: glob, frontmatter reads, up to 50 subagents. The `explain_removal` node fires, the gate is presented, the user declines. Nothing changes.

There is a second semantic problem. A user who clicks "No" at `remove_gate` is making a specific assertion: the verifier is wrong. The illumination is valid and should be kept open. But the pipeline treats this as "do nothing" rather than "override the verifier's verdict." That means the illumination cannot advance through the pipeline on this run, even though the human just argued it should. The correct response to "I disagree with the verifier" is to treat the illumination as having passed verification — not to exit without action.

The `every-action-needs-an-escape` meta-meditation names this pattern: flows need cancel paths, but a cancel that loops back to the same state is not a path out — it's a modal with a close button that doesn't close.

## Revised Implementation Steps

1. **Change `remove_gate → No` to route to `approval_gate` instead of `done` in `illumination-to-implementation.dot`.** The single edge change is: `remove_gate -> approval_gate [label="No"]`. Delete the current `remove_gate -> done [label="No"]` edge. The `approval_gate` already exists in the pipeline and accepts `$illumination_path`, `$summary`, and `$explanation` as its display variables. No new nodes required. A user who says "No" at `remove_gate` — asserting the verifier is wrong — is now forwarded to the approval gate where they make a real decision: Approve (proceed to design), Decline (archive with reason), or Chat (refine scope). Each of these produces a state transition. The limbo path is closed.

2. **Update `remove_gate`'s label to clarify the consequence of "No".** The current label reads: "Remove this illumination? / $illumination_path / $explanation". Change the sub-label to: "Yes → archive as invalid. No → override verifier, proceed to approval." A user who sees this understands that "No" is not "skip for now" — it is an assertion that the illumination is valid and should proceed. This prevents the gate from misleading users into a "No" they don't actually intend.

3. **Confirm `approval_gate → Decline` properly closes the loop.** The `approval_gate → Decline → mark_archived` path already exists and archives the illumination with a reason drawn from `$summary`. After the routing change in step 1, this becomes the terminal path for "I overrode the verifier but then decided not to act." The state transition happens; the illumination will not be re-surfaced. Verify that `mark_archived`'s reason text makes sense when called from this path — the reason will reflect the illumination's summary, which is correct for a user-initiated decline.

4. **Verify the `remove_gate → Yes` path does not need updating.** T2100 proposes changing `delete_file` to `archive_invalid` on this path. That change is orthogonal and should still be applied. After both fixes: Yes → archive as invalid (T2100), No → proceed to approval (this illumination). The gate then has two clean, stateful exits.

5. **Check whether any existing checkpoint files have a `currentNode` of `done` from a previous `remove_gate → No` traversal.** If `--resume` is run after a prior "No" exit, the checkpoint would show `done` as completed and the pipeline would consider itself finished. This is harmless — the resume would simply report completion immediately. No corrective action needed, but worth knowing before deploying the routing change.
