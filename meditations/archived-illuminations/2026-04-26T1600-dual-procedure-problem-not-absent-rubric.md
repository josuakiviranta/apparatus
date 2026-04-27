---
date: 2026-04-26
status: archived
description: The rubric-prepend fix (shipped v0.1.32) means memory_writer now receives two competing numbered step lists in one prompt — the 8-step rubric and the 6-step node-task inline procedure — and the shorter, later list wins; the fix is deleting the inline steps, not adding tool nodes.
archived_at: 2026-04-27
reason: Already shipped - inline steps removed and mark_implemented wired in step 7b of rubric
---

## Core Idea

T1200–T1500 all assumed the memory_writer node prompt's 6-step inline procedure was a "shadow procedure" hiding the rubric from the LLM. That was true before the rubric-prepend fix shipped (v0.1.32). It is no longer true. `agent-handler.ts:79` unconditionally assembles `agentRubric + "\n\n---\n\n" + expandedTask` when both are present. The LLM now receives the 8-step rubric first, then the 6-step inline list from the node task after the separator. The problem is not an absent rubric — it is two competing numbered step lists, where the later, shorter one is closer to the JSON constraint reminder and therefore acts as the operative procedure.

## Why It Matters

The practical consequence: `mark_plan_implemented` (rubric step 7) and `mark_implemented` (not yet in the rubric) fire only if the LLM follows the rubric's 8-step list. But the node task — sitting between the rubric and the `REMINDER: Output MUST be valid JSON` footer — re-enumerates steps 1–6 ending with "Return structured JSON with memory_path." That 6-step list is the nearest numbered procedure to the JSON enforcement fence. LLMs follow the most locally active instruction context; the inline list wins.

The actual structure of the assembled prompt (readable at `~/.ralph/runs/<run_id>/<node_id>/prompt.md`) is:

```
[preamble: context values]
IMPORTANT: Your FINAL response MUST be valid JSON ... Schema: {memory-writer.json}
[rubric: 8-step procedure, mission, hard rules]
---
[node task: "Close out the pipeline session. Follow your agent-level procedure: 1…6. Return structured JSON."]
REMINDER: Output MUST be valid JSON …
```

Step 7 (`mark_plan_implemented`) and any future step 8 (`mark_implemented`) live in section 3 — before the separator. The inline re-enumeration in section 4 effectively overwrites them by numbering from 1 again and ending at 6. This is not a shadow procedure (rubric absent); it is a dual-procedure conflict (rubric present but outcompeted).

The diagnostic is verifiable: read `~/.ralph/runs/<any recent run>/memory_writer/prompt.md`. Both step lists are there. No engine change is needed — just deleting the inline step list from the `.dot` node attribute fixes the conflict entirely.

## Revised Implementation Steps

1. **Open `pipelines/illumination-to-implementation.dot` and locate the `memory_writer` node.** The `prompt=` attribute currently ends with `"\n6. Return structured JSON with memory_path."` — delete all numbered steps (1–6) and replace with the single line `"Follow your agent-level procedure."` Keep the variable-injection lines (`Run id: $run_id`, `Project: $project`, etc.) — those are context, not procedure.

2. **Add `mcp__illumination__mark_implemented` to `memory_writer.md` tools list.** `mark_plan_implemented` is already whitelisted. `mark_implemented` is the illumination-side closer and follows the same pattern. One additional line in the `tools:` array.

3. **Add step 8 to the `memory_writer.md` procedure (before the JSON emit, after step 7).** Mirror step 7's best-effort pattern: call `mark_implemented` with `$illumination_path`. On `success: false`, append a bullet to `Learnings from the run`. Do not abort. Renumber the existing JSON-emit step to step 9.

4. **Add a hard-rule bullet to `memory_writer.md`** codifying that `mark_implemented` is best-effort under the same contract as `mark_plan_implemented` — never abort on `success: false`.

5. **Verify by reading the assembled prompt.** After the pipeline runs once, open `~/.ralph/runs/<run_id>/memory_writer/prompt.md`. Confirm: one numbered step list (8 steps from rubric) with no competing re-enumeration below the separator. Confirm: both `mark_plan_implemented` and `mark_implemented` appear in steps 7 and 8.
