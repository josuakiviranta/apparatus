---
date: 2026-04-30
status: open
description: The dispatched T1000 plan prescribes a DOT-level fix that predates v0.2.0 — implement.md now uses inputs: frontmatter for structured context, so the plan's retry-context fix routes through the legacy Key-context-values side-channel and the agent has no inputs declaration or procedure step to act on it.
---

## Findings

1. **What:** `docs/superpowers/plans/2026-04-18-implement-retry-tmux-context.md` (dispatched plan for T1000) was authored pre-v0.2.0 and prescribes adding `default_test_result=""` / `default_summary=""` as DOT node attributes plus expanding `$test_result` / `$summary` into the `implement` node's `prompt=` string. Post-v0.2.0, `implement.md` declares `inputs: [plan_writer.plan_path]` — only one structured input; `test_result` and `test_summary` are absent from the Inputs declaration. Implementing the plan as-written makes these values available in the "Key context values" preamble (legacy global dump) but not in the structured XML Inputs block the agent now reads. The agent rubric has no procedure step that references retry test output.
   - **Evidence:**
     - `pipelines/illumination-to-implementation/implement.md:9-10`: `inputs:\n  - plan_writer.plan_path` — single declared input, no `test_result` or `test_summary`
     - `pipelines/illumination-to-implementation/pipeline.dot:31`: `implement [agent="implement", max_retries=1]` — no `default_test_result` attribute exists today
     - T1000 plan Step 1 (verbatim): `"Add \`default_test_result=""\` and \`default_summary=""\` to the \`implement\` node declaration in \`pipelines/illumination-to-implementation.dot\`"` — DOT attribute only; no corresponding `inputs:` step
     - T1000 plan Step 2 (verbatim): `"Append a conditional paragraph to the \`implement\` node's \`prompt=\`"` — `prompt=` on agent nodes is a steering channel; T0129 documents it as pure prose (D6: not substituted by the engine's intent, currently substituted only because `prompt` remains in `STRING_ATTRS` — a bug T0129 proposes fixing). If T0129 ships before T1000, the `$test_result` expansion in Step 2 becomes a literal string, not a substitution.
     - `pipelines/illumination-to-implementation/implement.md` rubric body — no step references `<test_result>` or `<test_summary>` XML tags; the agent has no instruction to look for retry context.
   - **Why it matters:** The T1000 plan's goal is to give the implement agent ground truth on retry so it fixes the right failing tests. Implementing the plan as-written routes the test data through the legacy Key-context-values dump (unstructured, unsignal) while the agent's procedure points nowhere. The retry context injection remains a no-op in practice: the data is present but the agent is not directed to it. Additionally, if T0129's proposed `STRING_ATTRS` cleanup lands before T1000, Step 2 silently breaks — no validator or test would catch it.
   - **Suggested action:** Prepend two steps to the T1000 plan before its current Step 1:
     - **New Step 0a:** Add `test_result` and `test_summary` to `implement.md`'s `inputs:` list (bare keys with `default_test_result=""` and `default_test_summary=""` fallback attributes on the DOT node). This surfaces them as `<test_result>` / `<test_summary>` XML tags in the structured Inputs block.
     - **New Step 0b:** Add a procedure paragraph to `implement.md`'s rubric body (not `prompt=`): "If `<test_result>` in your Inputs block is non-empty, prioritise fixing those specific failures before re-running the full suite." Placing the directive in the rubric body (not the DOT `prompt=`) makes it durable through T0129's proposed STRING_ATTRS cleanup.
     - Drop Step 2 of the current plan (the `prompt=` expansion) — it is the structurally fragile channel; the rubric step replaces it.

## Lifecycle changes this run

- (none) — all five dispatched illuminations have pending (not implemented) plans; no `mark_implemented` calls.

## Reading thread

- `2026-04-30T0129-same-key-three-spellings.md` — established that `prompt=` on agent nodes is D6 pure prose, not a stable substitution channel; directly explains why T1000's Step 2 (prompt= expansion) is fragile and may silently break if T0129 ships first.
- `2026-04-30T0149-janitor-vision-tag-mismatch.md` — confirmed the v0.2.0 inputs: / XML-tag contract by showing janitor.md's `inputs: [vision]` renders as `<vision>`, not the old `<read_vision_vision>`; same rendering logic governs whether `test_result` appears as `<test_result>` in the Inputs block (it won't without an `inputs:` declaration).
- `2026-04-19T1000-implement-retry-is-blind-to-tmux-test-output.md` — the dispatched illumination this finding addresses; confirmed the original diagnosis (implement gets only `$plan_path` on retry) is still true; only the prescribed remedy is now incomplete.
- `2026-04-25T1100-janitor-lifecycle-orphan-plans.md` — context on stale plan prescriptions; T1100 documented plans whose plan_path chains broke; this finding documents a plan whose implementation steps became technically incorrect after a major engine redesign, a different class of plan staleness not previously named.