---
date: 2026-04-26
status: archived
description: T1600+T1700 fix lands plan closure in the rubric but leaves the illumination dispatched forever — mark_implemented is absent from both the rubric procedure and the tools whitelist, so the open-close pair is half-designed even after the shadow-procedure fix ships.
archived_at: 2026-04-27
reason: memory-writer.md already lists mark_implemented and step 7b closes illumination best-effort
---

## Core Idea

T1600 (delete the inline 6-step node prompt) and T1700 (best-effort close = rubric step) together repair the plan lifecycle closure. But they only repair one half of the open-close pair. `mark_dispatched` opens two artifacts — the illumination frontmatter and the plan frontmatter. `mark_plan_implemented` in the rubric closes the plan. Nothing closes the illumination. `mcp__illumination__mark_implemented` appears nowhere in `memory-writer.md`: not in the procedure, not in the tools whitelist.

## Why It Matters

`mark_dispatched` in `illumination-to-implementation.dot` is a structural tool node — mandatory, non-skippable. It writes `status: dispatched` plus `plan_path` into the illumination frontmatter. That open was designed correctly. The close was not designed at all: `mark_implemented` is missing from `src/cli/agents/memory-writer.md`'s `tools:` list and from its 8-step procedure. After T1600+T1700 ship, every pipeline run will close the plan (`status: implemented`) and leave the illumination stranded at `dispatched` — the exact dead-end state T0100 identified as the original lifecycle failure.

The open-close lens is clear: every open needs its close named in the same breath. `mark_dispatched` was built without `mark_implemented` as its named counterpart in the terminal node.

## Revised Implementation Steps

1. **Delete the inline 6-step list from the `memory_writer` node prompt** in `pipelines/illumination-to-implementation.dot`. Keep only the input-variable block (`Run id: $run_id`, `Project: $project`, etc.) — no numbered procedure. The rubric's 8-step procedure takes over uncontested. (This is T1600's fix; land it first since T1700 depends on it.)

2. **Add `mcp__illumination__mark_implemented` to the `tools:` whitelist** in `src/cli/agents/memory-writer.md` — alongside the existing `mcp__illumination__mark_plan_implemented` entry. Without this, Claude cannot call the tool even if the rubric asks for it.

3. **Extend rubric step 7** in `src/cli/agents/memory-writer.md` to close the illumination as best-effort alongside the plan. After the existing `mark_plan_implemented` call, add: if `$illumination_path` is set, call `mark_implemented` with the basename of `$illumination_path`; on failure, append a note to Learnings and continue. Same error-tolerance policy as plan closure — never abort.

4. **Bump "Emit structured JSON" from step 8 to step 9** in the rubric to preserve sequential ordering.

5. **Add a unit test** in `src/cli/tests/illumination-server.test.ts` (or the artifacts test) asserting that after a simulated memory-writer run, the illumination frontmatter reads `status: implemented`. This is the CI-visible proof that the close fires.
