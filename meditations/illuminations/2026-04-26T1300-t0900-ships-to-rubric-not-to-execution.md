---
date: 2026-04-26
status: open
description: T0900's mark_plan_implemented landed in the rubric at step 7, but the memory_writer node prompt still enumerates its own 6-step procedure ending with "Return structured JSON" — placing the MCP call in a structural dead zone where the LLM has a natural stopping point before reaching it, making the "shipped" plan-lifecycle closure unreliable in every actual pipeline run.
---

## Core Idea

T0900 shipped `mark_plan_implemented` as step 7 of `memory-writer.md`. The rubric now has 8 steps — step 7 calls the MCP tool, step 8 emits JSON. The commit landed. The fix is real. But it doesn't fire reliably.

The `memory_writer` node in `pipelines/illumination-to-implementation.dot` re-enumerates a 6-step procedure that ends with: *"6. Return structured JSON with memory_path."* That is a terminal instruction in the node prompt. When `agent-handler.ts` assembles the full prompt as `[rubric]\n\n---\n\n[node prompt]`, the LLM sees two competing procedure lists. The node prompt's step 6 — "return JSON now" — is a later, self-contained, authoritative stopping point. The rubric's steps 7 and 8 appear earlier in the assembled text and may never be reached. T0900 shipped to the rubric. The node prompt is the execution path.

This is the same pattern T1200 diagnosed generically (node prompts that re-enumerate steps create shadow procedures), but T1200 named it as a future risk for the pending T1100 additions. The risk is already present for T0900's shipped fix.

## Why It Matters

Every `memory_writer` execution in the current pipeline is a non-deterministic coin flip between two stopping points:

- **Node prompt step 6**: "Return structured JSON with memory_path." → MCP call never happens, plan stays `pending`.
- **Rubric step 8**: Emit JSON, after step 7 calls `mark_plan_implemented`. → Plan closes.

T0900's stated goal — reliable plan-lifecycle closure — is not achieved in practice. The plan frontmatter will read `pending` on runs where the LLM follows the node prompt's list to completion. This means the janitor's reconciliation loop, which reads `plan.status === "implemented"` to close illuminations, has no reliable signal.

T1100's forthcoming `mark_implemented` addition (illumination closure as step 8) would land in the same dead zone. Both lifecycle steps — plan and illumination — would be structurally optional rather than structurally mandatory, despite appearing in the rubric.

The "proof of work" (step in the rubric) is not the same as "proof of usage" (MCP call actually fires in a real run). The commit creates the appearance of a closed loop without creating one.

The concrete evidence lives in `pipelines/illumination-to-implementation.dot` at the `memory_writer` node:

```
prompt="Close out the pipeline session.\n\nFollow your agent-level procedure:\n1. Derive the memory filename...\n6. Return structured JSON with memory_path."
```

Step 6 terminates the list. Rubric steps 7 and 8 are unreachable.

## Revised Implementation Steps

1. **Edit the `memory_writer` node prompt in `pipelines/illumination-to-implementation.dot`.** Remove the numbered 1–6 step list entirely. Replace it with a pure input manifest and a single directive:

   ```
   prompt="Close out the pipeline session.\n\nInputs:\n- Run id: $run_id\n- Project: $project\n- Plan: $plan_path\n- Design doc: $design_doc_path\n- Illumination: $illumination_path\n- Final test result (empty if skipped): $test_result\n- Final test summary: $test_summary\n\nFollow your agent-level procedure."
   ```

   This makes ALL rubric steps reachable — steps 7 and 8 are no longer in a shadow zone.

2. **Verify step 7 fires.** After the DOT edit lands, run the pipeline against a real `open` illumination (or a fixture run). After `memory_writer` exits, confirm `$plan_path` frontmatter reads `status: implemented`. This is the first real proof of usage for T0900.

3. **Then apply T1100.** Add `mcp__illumination__mark_implemented` to `memory-writer.md` tool whitelist and add step 8 to the rubric procedure. The shadow procedure is now gone — step 8 is immediately reachable, and both lifecycle signals close in a single node exit.

4. **Audit `implement` and `tmux_tester` node prompts for the same pattern.** Both re-enumerate steps in their node prompts. Neither currently has lifecycle-critical rubric steps past their node prompt lists, but any future rubric addition will land in the same dead zone unless the input-manifest convention is applied.

5. **Add the lint heuristic from T1200 step 5.** A `ralph pipeline validate` advisory warning when `prompt=` contains a numbered list (`/^\d+\./m`) prevents the pattern from re-emerging in new nodes.
