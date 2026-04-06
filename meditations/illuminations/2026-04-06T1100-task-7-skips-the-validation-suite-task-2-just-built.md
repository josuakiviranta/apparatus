# Task 7 Skips the Validation Suite Task 2 Just Built

## Core Idea

The run-scenarios plan's Task 2 adds three subprocess tests to `meditate.test.ts` — stub exits 1 emits a warning, stub exits 0 does not, `tool_use` stream line produces `→ [tool]` output. These three tests define the session runner contract. Task 7 writes `runScenarioSession`, which is supposed to be behaviorally equivalent. Task 7 adds zero subprocess tests for `runScenarioSession`. After the plan executes, the two session runners sit at 3 vs 0 coverage. Gene transfusion without the validation suite is not transfusion — it is wishful copying.

## Why It Matters

The gene-transfusion pattern is explicit: "The key ingredient is not the exemplar alone — it is the exemplar paired with tests. Tests define what equivalence means." Task 2 manufactures both halves of a valid exemplar: the implementation (`RALPH_TEST_CMD`, exit-code warning, tool-use indicator) and the tests that verify it. Task 7 is written in the same plan but was authored before Task 2 existed — it reaches for the pre-Task-2 `meditate-create.ts` (which has no session runner tests) instead of the post-Task-2 `meditate.ts` (which does).

The consequence is observable in `docs/superpowers/plans/2026-04-05-run-scenarios.md`. Task 6 creates `src/cli/tests/run-scenarios.test.ts` with 18 pure-function tests covering `slugify`, `parseScenarioHeader`, `discoverScenarios`, and `buildScenarioPrompt`. Task 7's Step 2 says "Run unit tests to confirm no regressions" — it checks that the pure-function tests still pass. No new tests are added for `runScenarioSession`. The subprocess is the riskiest part of the command (it spawns Claude, runs for up to 25 minutes, writes files) and it ships with no test coverage because no one explicitly claimed Task 2's test structure as the template.

The existing `meditate.test.ts` already shows what this looks like in the codebase: 28 tests cover exported utilities (`buildMeditationArgs`, `writeMcpConfig`, `pidPath`, etc.) with zero tests for `runMeditationSession` — because it isn't exported yet and has no `RALPH_TEST_CMD`. That's exactly the state run-scenarios will be in after Task 7 ships. The plan repeats the pre-Task-2 pattern for a second function without noticing that Task 2 exists to fix it.

## Revised Implementation Steps

1. **Add a `runScenarioSession` subprocess test block to Task 7 of the plan.** Insert it as Step 2 in Task 7, mirroring Task 2's three tests exactly: (a) `makeStub("exit 1")` → stderr contains `Warning: scenario session exited with code 1`; (b) `makeStub("exit 0")` → no warning; (c) stub emitting a `tool_use` stream line → stdout contains `→ [tool] <toolname>`. Label this block "runScenarioSession — subprocess behavior." Derive `RALPH_TEST_CMD` in `runScenarioSession` the same way Task 2 derives it in `runMeditationSession`. Export `runScenarioSession` the same way Task 1 exports `runMeditationSession`.

2. **Add a fourth test for SIGINT cleanup in the same block.** Send SIGINT to the spawned stub mid-run. Assert the child process is terminated (check via `isNaN(child.exitCode)` or a short-lived stub that sleeps). Assert the outer `Promise` resolves rather than hanging. This test is the one thing `runMeditationSession`'s Task-2 tests don't cover — `meditate.ts` already has SIGINT cleanup, but its test was not required by Task 2. For `runScenarioSession`, which runs unattended for 25 minutes, the cleanup path must be tested.

3. **Add an export directive to `runScenarioSession` in Task 7 Step 1**, matching the export Task 1 adds to `runMeditationSession`. The export is what makes the function importable in the test file. Without it, writing the tests above is impossible.

4. **Amend the Task 7 architecture comment** to read: "Derives `runScenarioSession` from the `meditate.ts` produced by Tasks 1–2 of this plan. The three tests in the Task-2 describe block are the validation suite for this transfusion — `runScenarioSession` must pass structurally identical tests. Read `src/cli/commands/meditate.ts` (as amended) before writing this function."

5. **After both `runMeditationSession` and `runScenarioSession` have passing subprocess test suites, mark `src/cli/lib/claude-session.ts` as the extraction target.** The tests are the safety net for that extraction. Do not plan the extraction before both suites exist — the extraction is only safe once equivalence is proven, not asserted.
