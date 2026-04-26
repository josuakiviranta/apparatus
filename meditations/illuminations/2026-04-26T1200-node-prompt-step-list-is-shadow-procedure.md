---
date: 2026-04-26
status: open
description: The memory_writer node prompt re-enumerates 6 steps ending in "Return structured JSON" — but the rubric has 8 steps with mark_plan_implemented at step 7 — creating a competing shadow procedure that can short-circuit the rubric before lifecycle closure fires.
---

## Core Idea

`agent-handler.ts` assembles prompts as `[rubric]\n\n---\n\n[node prompt]`. The rubric is prepended, not replaced. But when a node prompt re-enumerates the procedure as a numbered list, that list acts as a shadow procedure — the LLM sees two competing instruction sequences and may follow the shorter, later one. The `memory_writer` pipeline node prompt ends its 6-step list with "Return structured JSON with memory_path." That is a terminal instruction. Rubric steps 7 (`mark_plan_implemented`) and 8 (emit JSON) appear earlier in the assembled text but the node prompt's list overrides them by providing a fresh, self-contained procedure that terminates before they run.

## Why It Matters

`memory_writer` was recently updated to call `mark_plan_implemented` as step 7 of its rubric. The commit shipped. But the pipeline node in `pipelines/illumination-to-implementation.dot` has `prompt="Close out the pipeline session.\n\nFollow your agent-level procedure:\n1. Derive the memory filename...\n6. Return structured JSON with memory_path."` — six explicit steps, the last of which says emit JSON. When an LLM reads this after the rubric preamble, step 6 of the node prompt is a plausible stopping point that comes after all six numbered items are complete. Whether step 7 fires depends entirely on which instruction list the LLM treats as authoritative — that is not a guarantee, it is a coin flip.

The same pattern would apply to the forthcoming `mark_implemented` step for illumination closure (T1100). Adding step 8 to the rubric without updating the node prompt's enumeration would put it in the same structural dead zone.

The root pattern: **node prompts that re-enumerate steps create a shadow procedure**. Any step in the rubric that appears after the node prompt's last numbered item is structurally optional — the LLM has a natural stopping point before reaching it.

## Revised Implementation Steps

1. **Remove the step-enumeration from `memory_writer`'s node prompt in `pipelines/illumination-to-implementation.dot`.** Replace the numbered 1-6 list with a concise input manifest: the variables the agent needs (`$run_id`, `$project`, `$plan_path`, `$design_doc_path`, `$illumination_path`, `$test_result`, `$test_summary`). Keep "Follow your agent-level procedure." as a single directive line, with no re-enumeration of steps.

2. **Add `mcp__illumination__mark_implemented` to `memory-writer.md` tool whitelist** (adjacent to `mcp__illumination__mark_plan_implemented`). The MCP block is already present.

3. **Add step 8 to `memory-writer.md` procedure**: best-effort `mark_implemented` call on `$illumination_path`, mirroring the step-7 contract exactly — log failures to Learnings, never abort.

4. **Audit all other pipeline node prompts for numbered-step lists.** Any node whose prompt re-enumerates the rubric procedure creates the same shadow-procedure risk. The fix is the same: replace step lists with input manifests + "Follow your agent-level procedure." `implement`, `tmux_tester`, and `verifier` are the most likely candidates given they also have procedural rubrics.

5. **Add a lint rule to `ralph pipeline validate` (or lint lane) that warns when a node prompt contains a numbered list.** Heuristic: if `prompt=` matches `/^\d+\./m`, emit an advisory: "Node prompt contains a numbered list — consider moving steps to the agent rubric and using an input manifest in the node prompt instead."
