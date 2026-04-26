---
date: 2026-04-26
status: open
description: T0900's mark_plan_implemented was added to the memory_writer rubric at step 7, but the node prompt's competing 6-step inline procedure terminates at "Return structured JSON" before step 7 ever fires — making the shipped plan-closure inert, and the missing mark_implemented for the illumination side means both closures require one atomic three-change diff to land.
---

## Core Idea

T0900's plan-closure fix was implemented: `src/cli/agents/memory-writer.md` now has `mark_plan_implemented` whitelisted in `tools:` and a step 7 procedure entry. But `pipelines/illumination-to-implementation.dot` still contains a competing 6-step inline procedure on the `memory_writer` node that ends with `"6. Return structured JSON with memory_path."` After rubric-prepend shipped (v0.1.32), the LLM receives both procedure lists; the inline list wins because it forms a complete, self-terminating task at step 6. Steps 7 and 8 in the rubric are structurally unreachable. The plan-closure the design doc describes as "shipped" has never fired in a live pipeline run.

Two gaps compound: (1) the shadow procedure blocks step 7, and (2) `mark_implemented` for the illumination is absent from both the tools whitelist and the rubric (T1800). Both closures require the same prerequisite — deleting the shadow — making them a single atomic commit.

## Why It Matters

Static verification (grep, code review) cannot detect this failure. `grep mark_plan_implemented src/cli/agents/memory-writer.md` returns a hit and the rubric looks correct. The bug lives entirely in the LLM's prompt resolution — the inline steps in the node prompt override the rubric because they appear as a later, complete numbered list. No test currently runs a live pipeline and asserts that `mark_plan_implemented` was called, so the dead-zone is invisible to CI.

The consequence: every plan produced by `illumination-to-implementation.dot` stays `status: pending` indefinitely. The janitor reconciliation loop reads plan status as the trigger for `mark_implemented` on the illumination side. With plans perpetually `pending`, dispatched illuminations accumulate forever — the same T1000 pattern (`mark-implemented has no caller`) that the entire 2026-04-26 session was diagnosing.

Three files hold the blocking state: `pipelines/illumination-to-implementation.dot` (shadow procedure), `src/cli/agents/memory-writer.md` tools list (missing `mark_implemented`), and `src/cli/agents/memory-writer.md` procedure (missing step 8).

## Revised Implementation Steps

1. **Delete the shadow procedure from the DOT node prompt.** In `pipelines/illumination-to-implementation.dot`, find the `memory_writer` node's `prompt=` attribute. Remove the block `"Follow your agent-level procedure:\n1. Derive the memory filename...\n6. Return structured JSON with memory_path."` leaving only the context-variable lines (`Run id: $run_id`, `Project: $project`, etc.) followed by a bare `"Follow your agent-level procedure."` This unblocks rubric steps 7 and 8.

2. **Add `mcp__illumination__mark_implemented` to `memory-writer.md` tools list.** In `src/cli/agents/memory-writer.md` frontmatter, add the tool below the existing `mcp__illumination__mark_plan_implemented` entry. Without this the rubric step cannot call the tool.

3. **Add step 8 to the `memory-writer.md` procedure.** Insert before the current "Emit structured JSON" step: *"Mark the illumination implemented (best-effort). Extract the basename of `$illumination_path` and call `mark_implemented`. On `success: false`, append the error to the memory file's `Learnings` section and continue. On empty `$illumination_path`, append a one-line skip note and continue. Do not abort the node."*

4. **Add a matching Hard rules bullet** in `memory-writer.md`: `mark_implemented` is best-effort — same contract as the existing `mark_plan_implemented` bullet already present.

5. **Verify atomically.** After all three edits: grep `memory-writer.md` for both `mark_plan_implemented` and `mark_implemented` (two tool entries, two procedure steps, two hard-rules bullets). Grep the DOT node prompt for "Return structured JSON" — it must not appear inside the `memory_writer` node's `prompt=` attribute. The inline procedure is gone; the rubric is authoritative.