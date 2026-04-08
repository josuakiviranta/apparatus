---
date: 2026-04-06
description: '`docs/superpowers/plans/2026-04-05-run-scenarios.md` Tasks 1–2 modify `meditate.ts` to add `RALPH_TEST_CMD ?? "claude"`, an exit-code warning, and tool-use indicators.'
---

# The Plan Creates Its Own Exemplar in Task 2

## Core Idea

`docs/superpowers/plans/2026-04-05-run-scenarios.md` Tasks 1–2 modify `meditate.ts` to add `RALPH_TEST_CMD ?? "claude"`, an exit-code warning, and tool-use indicators. The result is a fully correct session runner. Task 7, written in the same plan, then writes `runScenarioSession` from scratch — referencing `meditate-create.ts` as its exemplar — without noticing that Tasks 1–2 just produced the exact model it should copy. The plan unknowingly creates the right exemplar and then ignores it four tasks later.

## Why It Matters

T2800 said "name the exemplar explicitly." T3300 said "the exemplar should be `meditate.ts`, not `meditate-create.ts`." Both are correct. But the gap they don't close is this: when Task 7 executes, `meditate.ts` has already been amended by Tasks 1–2 of this same plan. The post-amendment `meditate.ts` contains `RALPH_TEST_CMD`, SIGINT cleanup, and an exit-code check in the close handler — exactly the four properties Task 7's `runScenarioSession` needs. The executing agent has that file open, freshly edited, in context. It does not need to be told to read it as an external reference. It needs to be told: *the file you just modified is the exemplar*.

The plan's architecture header was written before Tasks 1–2 existed. It reaches back to the pre-amendment codebase and names `meditate-create.ts`. That name travels all the way to Task 7, where the implementing agent copies `--dangerously-skip-permissions` (from `meditate-create.ts:buildMeditateCreateKickoffArgs`) instead of `--permission-mode dontAsk` (from the now-amended `meditate.ts:buildMeditationArgs`). This is not a knowledge gap — the correct code is in the same context window, written two tasks earlier. The plan simply never draws the connection.

The consequence is specific. An agent running Tasks 1–2 correctly, then reading the architecture header before Task 7, will anchor on `meditate-create.ts`. It will produce a `runScenarioSession` with `--dangerously-skip-permissions`, no SIGINT handler, and no `RALPH_TEST_CMD`. Five of the six pre-diagnosed bugs come from this single wrong anchor. The correct code is already in context. The plan's prose routes around it.

## Revised Implementation Steps

These are targeted amendments to `docs/superpowers/plans/2026-04-05-run-scenarios.md`:

1. **Architecture header: delete the exemplar sentence and replace it with a forward reference.** Change "follows the `meditate-create.ts` non-interactive session pattern" to: "Task 7 derives `runScenarioSession` from the `meditate.ts` produced by Tasks 1–2 of this plan — not from the pre-amendment codebase." This makes the temporal dependency explicit: Task 7's exemplar is a future artifact of the plan itself, not a present file.

2. **Task 7 Step 1: add an explicit re-read directive.** Before any implementation prose, add: "Step 0: Reread `src/cli/commands/meditate.ts` as it exists now (after Tasks 1–2 have run). Identify: the `RALPH_TEST_CMD ?? "claude"` pattern, the SIGINT/SIGTERM cleanup handler, the close-handler exit-code check. `runScenarioSession` must reproduce all three. Do not read `meditate-create.ts` as reference for this function." Two sentences. Prevents the wrong copy.

3. **Task 7 Step 1 continued: inline the four required properties as assertions.** After the re-read directive, list the properties that `runScenarioSession` must have — not as prose but as verifiable claims: (a) `process.env.RALPH_TEST_CMD ?? "claude"` as the spawn command, (b) `--permission-mode dontAsk` not `--dangerously-skip-permissions`, (c) SIGINT handler calling `child.kill("SIGTERM")` before close, (d) `existsSync(outPath)` check with stderr warning on missing artifact. Each property has a matching test in step 4. Properties are checkable; exemplar references are not.

4. **Enforce the task 5/7 ordering dependency.** T3400 correctly identified that `PROMPT_scenario.md` must be written after `buildScenarioArgs` settles the permission model. The plan has Task 5 before Task 7. Add a note to Task 5: "Placeholder only — write the actual prompt content after Task 7 Step 1 settles the `--allowedTools` list. The tools the prompt instructs Claude to use must match the tools the args permit." The prompt is a derived artifact of the permission model, not an independent one.

5. **After applying amendments 1–4, add a status marker to the plan header.** Change the plan's opening to include `Status: Ready` (the amendments have been integrated, the plan is safe to execute). Until this marker is present, treat the plan as `Draft` regardless of its completeness. The executing-plans skill should check for this marker and refuse to begin Task 1 if it reads `Draft`.
