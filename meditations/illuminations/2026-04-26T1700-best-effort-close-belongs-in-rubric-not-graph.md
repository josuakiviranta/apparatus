---
date: 2026-04-26
status: open
description: mark_dispatched (mandatory open) belongs as a structural tool node; mark_plan_implemented (best-effort close) belongs as a rubric step — reliability requirement, not position in the open/close pair, determines enforcement layer, which explains why T1600's fix is correct and T1400's tool-node proposal would create an irreconcilable conflict.
---

## Core Idea

The pipeline's open/close lifecycle pair has asymmetric reliability requirements. `mark_dispatched` (open) is mandatory — the pipeline cannot advance to `implement` without it, and it correctly lives as a structural tool node the engine calls unconditionally. `mark_plan_implemented` (close) is best-effort by design — a frontmatter-less or orphaned plan must never block the unconditional `git push`. Best-effort operations must not be structurally enforced. The enforcement layer must match the reliability requirement, not just mirror the shape of the open operation.

## Why It Matters

T1400 (`lifecycle-close-must-be-a-graph-node`) argued that because `mark_dispatched` is a tool node, its close counterpart should be one too — symmetry as the justification. T1600 (`dual-procedure-problem-not-absent-rubric`) argued that deleting the inline shadow steps from the `memory_writer` node prompt is the correct fix. Both are responding to the same broken state, but only T1600 lands in the right enforcement layer.

The conflict becomes concrete at failure time. A structural tool node has no graceful degradation path: if `mark_plan_implemented` fails (orphan plan, malformed frontmatter), the engine halts the node — blocking the `git push` that prior `implement` and `tmux-tester` commits depend on. The `memory_writer` rubric (`src/cli/agents/memory-writer.md:117–122`) explicitly encodes the fix for this: *"best-effort — never abort the node on `success: false`. Push and the JSON emit are non-negotiable; the lifecycle flip is opportunistic."* That contract can only be honored inside agent cognition (rubric step), not inside the engine's structural call sequence.

The shadow procedure bug (`memory_writer` node prompt in `pipelines/illumination-to-implementation.dot` re-enumerating 6 steps ending at "Return structured JSON") prevents the rubric's step 7 from ever firing — not because rubric steps are unreliable, but because the inline list is later in the assembled prompt and shorter, so the LLM has a natural stopping point before reaching the rubric's lifecycle close. T1600's fix (delete the inline list) is therefore both necessary and sufficient: it removes the stopping point and lets the rubric's best-effort step 7 run. Adding a structural tool node would fix the immediate symptom but violate the best-effort contract that makes the close safe.

The open/close meta-meditation says "design the pair, not the half." The correction here is: design the pair with matching reliability contracts — mandatory open gets structural enforcement, best-effort close gets cognitive enforcement.

## Revised Implementation Steps

1. **Delete the inline 6-step list from `memory_writer`'s `prompt=` in `pipelines/illumination-to-implementation.dot`.** Leave only the context variable bindings and a bare "Follow your agent-level procedure." sentence. The rubric already contains the full 8-step procedure including step 7 (mark_plan_implemented, best-effort) and step 8 (JSON emit).

2. **Verify the rubric's step 7 and hard-rules bullet are in place.** Grep `src/cli/agents/memory-writer.md` for `mark_plan_implemented` — it should appear in the tools list, the procedure (step 7, post-push, best-effort), and the hard-rules bullet. No rubric edits needed; the T0900 fix already landed these.

3. **Add a one-line authoring note to `specs/pipeline.md`** documenting the convention: mandatory lifecycle steps (cannot-skip, gate the next node) belong as tool nodes; best-effort lifecycle steps (log-and-continue on failure) belong as rubric steps. This prevents future pipeline authors from re-applying the T1400 pattern to operations designed for graceful degradation.

4. **Run a smoke verification** after the inline-step deletion: drive `pipelines/illumination-to-implementation.dot` end-to-end against a test illumination. Confirm the plan frontmatter flips to `status: implemented` (auto-commit from `mark_plan_implemented`) and that the pipeline exits 0. Then run the negative case (plan with no frontmatter): confirm push succeeds, JSON emit succeeds, memory file `Learnings` section logs the `success: false` error, node exits 0.
