---
date: 2026-04-11
description: The `approval_gate` "Decline" edge routes to `delete_agent`, not `done` — so a user who declines to proceed with a valid, verified illumination permanently destroys the file that the verifier's 50-subagent pass just confirmed is accurate and still relevant.
---

## Core Idea

In `illumination-to-plan.dot`, `approval_gate` has three outgoing edges: "Approve" → `design_writer`, "Decline" → `delete_agent`, and "Chat" → `chat_session`. The `delete_agent` node is shared with the false-verification path (`remove_gate → delete_agent`) — the same node used to discard illuminations the verifier has found stale or inaccurate. This means clicking "Decline" at the human review gate permanently deletes an illumination the verifier just spent up to 50 subagents confirming is technically accurate and still relevant. "Not now" and "delete forever" are the same button.

## Why It Matters

The `explainer` node (which runs before `approval_gate`) summarizes for the user exactly what the illumination proposes to change and why. That context is correct — the verifier confirmed it. But if the user decides the timing is wrong, the scope is too wide, or they simply want to defer the work, clicking "Decline" destroys the illumination file. There is no undo.

This makes the pipeline non-idempotent in the worst direction: a user who runs `ralph pipeline run illumination-to-plan.dot`, reaches `approval_gate`, and clicks "Decline" loses the very record they came to review. The next pipeline run will find the file gone. The `verifier` will route to `done` via `preferred_label=empty` if no other illuminations exist.

The problem exists in `pipelines/illumination-to-plan.dot` at the two lines:
```dot
approval_gate -> delete_agent  [label="Decline"]
```
and the shared `delete_agent` node that both paths point to. The `remove_gate` path (for genuinely invalid illuminations) is correct: "No" → `done` (keep), "Yes" → `delete_agent` (remove). The `approval_gate` path has no equivalent "keep and exit" option.

This also interacts with the headless-gate illumination (T1500): in headless mode, `AutoApproveInterviewer` returns the first edge label for `approval_gate` — which is "Approve". That happens to be safe here (it won't delete). But if the edge order were changed (e.g., to put a safe default first), whoever reorders the edges might inadvertently make "Decline" → delete the first option.

## Revised Implementation Steps

1. **Change `approval_gate -> delete_agent [label="Decline"]` to `approval_gate -> done [label="Decline"]` in `pipelines/illumination-to-plan.dot`.** This makes "Decline" a clean exit that preserves the illumination. The user can delete it manually later or the verifier will re-evaluate it on the next run.

2. **Rename the label to "Skip" to communicate the new semantics.** `approval_gate -> done [label="Skip"]`. "Decline" implies rejection; "Skip" communicates deferral. A user choosing "Skip" understands the file is preserved; a user choosing "Decline" might expect it to be cleaned up. This is a UX clarity fix alongside the routing fix.

3. **Verify the `remove_gate` path is unchanged.** The false-verification path (`explain_removal → remove_gate → delete_agent [label="Yes"]`) is the correct and intended deletion path. It should not be touched. After step 1, `delete_agent` is only reachable via `remove_gate → "Yes"`, which is the correct semantic (user explicitly confirms deletion of a stale/inaccurate illumination).

4. **Update the `approval_gate` label in the DOT file to reflect the new option.** Currently: `approval_gate [shape=hexagon, label="Proceed with plan?\n\nIllumination: $illumination_path\nSummary: $summary"]`. Add a note: `"Options: Approve (write plan), Skip (defer), Chat (discuss)"` so the human gate display is self-documenting.

5. **Audit `AutoApproveInterviewer` behavior after the rename.** With the new edge order `["Approve", "Skip", "Chat"]`, `AutoApproveInterviewer` still returns "Approve" (first option) in headless mode — which is now also the correct safe default for the approval gate per illumination T1500's recommendation.
