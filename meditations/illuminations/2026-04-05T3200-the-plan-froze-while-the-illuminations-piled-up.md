# The Plan Froze While the Illuminations Piled Up

## Core Idea

`docs/superpowers/plans/2026-04-05-run-scenarios.md` was written once and has not changed. Eighteen illuminations have since diagnosed gaps in it: missing SIGINT handling, missing `RALPH_TEST_CMD` override in `runScenarioSession`, missing sort on `discoverScenarios`, missing read-path from `scenario-runs/` to `implement`, no exemplar named for `runScenarioSession`. The plan's header instructs an executing agent to use `superpowers:executing-plans`. That agent will read the plan file. It will not read the 18 illuminations. Every diagnosis produced by the meditation system will be silently absent when the implementation begins.

## Why It Matters

The workflow has two loops that do not converge. The observation loop: `ralph meditate` runs a Claude session that reads the codebase, writes illuminations to `meditations/illuminations/`. The execution loop: a developer opens the plan at `docs/superpowers/plans/`, runs `superpowers:executing-plans`, and implements task by task. The observation loop's output lives in a different directory from the execution loop's input. Nothing bridges them.

This is not a failure of illumination quality. The illuminations at T2600 (missing test override), T2800 (exemplar not named), T3000 (no SIGINT handling), and T3100 (no sort contract) are each actionable and correct. The failure is architectural: illuminations write to `meditations/illuminations/` and plans are read from `docs/superpowers/plans/`. These paths never cross.

The consequence is measurable. Task 7 of the plan writes `runScenarioSession` from scratch. T2600 says it will omit `RALPH_TEST_CMD`. T2800 says it will drift from the `runMeditateCreateKickoff` exemplar. T3000 says it will have no cleanup or cancellation. All three of those things will happen, because the executing agent's only input is the plan, and the plan was written before those diagnoses existed. Eighteen sessions of observation will have zero effect on what gets built.

The situation is structurally similar to what T2900 identified for scenario reports: there is a write path, but no designed read path. The meditation system writes. The execute system reads. They were never connected.

## Revised Implementation Steps

1. **Before executing any plan, glob `meditations/illuminations/` for files dated at or after the plan file's date.** Read any illumination that mentions plan files, spec files, or code that the plan touches. This is the pre-execution integration step. It is currently missing from `superpowers:executing-plans`. Add it as an explicit instruction: "If `meditations/illuminations/` exists, read illuminations dated after the plan and incorporate any 'Revised Implementation Steps' as amendments before beginning Task 1."

2. **For this specific plan, amend Tasks 6 and 7 before any execution begins.** Task 6 (`discoverScenarios`) needs a sort step. Task 7 (`runScenarioSession`) needs: an explicit read of `src/cli/commands/meditate-create.ts` as the named exemplar, `RALPH_TEST_CMD ?? "claude"` in the spawn call, SIGINT/SIGTERM cleanup registration mirroring `meditate.ts`, and three vitest tests covering exit code warning, clean exit silence, and tool-use indicator output. None of this is in the plan. All of it is in the illuminations. The amendments take 10 minutes to write. The bugs they prevent take hours to diagnose.

3. **Add a `Status:` header to each plan file.** Candidates: `Draft`, `Ready` (illumination-integrated, ready to execute), `In Progress`, `Complete`. The run-scenarios plan is currently `Draft` by behavior — the illuminations have not been folded in — but it presents as `Ready`. The status field makes the integration step legible: a plan moves from `Draft` to `Ready` only when its illumination-era findings have been incorporated.

4. **Add an output path for illuminations that target plans.** Currently every illumination writes to `meditations/illuminations/`. Illuminations that identify gaps in a specific plan file could write an amendment directly as a comment block appended to the plan. The write tool restricts output to `meditations/illuminations/` — that restriction is correct for exploratory observations. But a separate `write_plan_amendment(plan_path, amendment_text)` tool, scoped to `docs/superpowers/plans/`, would let observation close the loop directly rather than requiring a human integration step.

5. **Treat the current gap as a one-time manual task before execution.** Read illuminations T2600, T2800, T3000, T3100 in order. Write the amendments they describe into the plan. Then execute. The observation system worked correctly — eighteen sessions produced eighteen real findings. The integration step was simply not designed. Do it manually this once; design it properly for the next plan.
