---
date: 2026-04-06
description: '`docs/superpowers/plans/2026-04-05-run-scenarios.md` will be executed today.'
---

# Six Amendments Before the Plan Executes

## Core Idea

`docs/superpowers/plans/2026-04-05-run-scenarios.md` will be executed today. Twenty illuminations were written yesterday diagnosing gaps in it. None of them patched the plan. An executing agent reading only the plan will produce code with six confirmed bugs. The amendments below are drawn directly from yesterday's illuminations — they need to go into the plan file before Task 1 begins, not after the bugs surface.

## Why It Matters

The six bugs are specific and pre-diagnosed. Each maps to a named illumination. The plan's architecture section says run-scenarios "follows the `meditate-create.ts` non-interactive session pattern" — this single sentence propagates the wrong permission model, the missing SIGINT handling, and the missing test override simultaneously, because it points at the wrong exemplar.

The correct exemplar for `runScenarioSession` is `meditate.ts`, not `meditate-create.ts`. The distinction is load-bearing: meditate-create is a short kickoff followed immediately by a user-supervised interactive session; the scenario runner is an unattended sequential loop lasting up to 25 minutes. These have different safety requirements. The plan got this wrong in the header. Everything in Task 7 inherits the mistake.

Additionally, the plan's test coverage follows the function boundary (pure utilities are tested; the command orchestration layer is not) instead of the risk boundary (the orchestration layer is where all six bugs live). The result is a green test suite over code that has known runtime failures.

## Revised Implementation Steps

These are amendments to make to `docs/superpowers/plans/2026-04-05-run-scenarios.md` before any task is executed:

1. **Architecture header: change the named exemplar.** Replace "follows the `meditate-create.ts` non-interactive session pattern" with "follows the `meditate.ts` unattended session pattern — no user supervision, constrained permissions." This single change reorients Tasks 5 and 7. (T3300)

2. **Task 6: add sort to `discoverScenarios` and a multi-file ordering test.** Add `.sort((a, b) => a.name.localeCompare(b.name))` to the `readdirSync` chain. Add a test that writes `test-beta.sh` before `test-alpha.sh` and asserts `discoverScenarios` returns alpha first. Without this, file ordinals shift when the folder changes — silently, with no error. (T3101)

3. **Task 7: replace `--dangerously-skip-permissions` with `--permission-mode dontAsk`.** Add `--allowedTools bash` to `buildScenarioArgs`. Add a test that asserts `--permission-mode dontAsk` is present and `--dangerously-skip-permissions` is absent. The scenario agent runs unattended and executes arbitrary bash scripts — it needs the constrained model, not the kickoff model. Write `PROMPT_scenario.md` (Task 5) after this decision, deriving the allowed tools from what the prompt instructs. (T3300, T3400)

4. **Task 7: add `RALPH_TEST_CMD` override to `runScenarioSession`.** Replace `spawn("claude", args, ...)` with `spawn(process.env.RALPH_TEST_CMD ?? "claude", args, ...)`. Then add three unit tests mirroring the meditate Task 2 tests: a stub exiting 1 emits a stderr warning; a stub exiting 0 does not; a stub emitting a `tool_use` stream line produces `→ [tool]` output. Without this, `runScenarioSession` is untestable and will ship with zero coverage — repeating exactly the meditate pattern this plan was motivated to fix. (T2600, T1900 analog)

5. **Task 7: add SIGINT cleanup registration inside `runScenarioSession`.** Register a cleanup handler before `spawn` that calls `child.kill("SIGTERM")` and sets a shared `cancelled` flag. Deregister in the close handler. Check `if (state.cancelled) break` after each `await runScenarioSession(...)` in the outer loop. Print a completion summary regardless of how the loop ends: `Completed: N/M scenarios.` A 20-minute run with no exit path is not acceptable. (T3000)

6. **Task 7: replace unconditional `console.log("Done: ...")` with an artifact check.** After `runScenarioSession` resolves, check `existsSync(outPath)`. If the file exists, print the done message. If not, write to stderr: `Warning: session completed but no report was written to scenario-runs/${outFile}`. Claude can exit 0 without writing the file — permission errors, prompt failures, and SIGINT all produce exit 0 with no artifact. (T2700)

These six amendments together take 20–30 minutes to write into the plan. Each of the bugs they prevent has been observed, named, and diagnosed. The observation work is done. The only remaining step is transcribing the findings into the document the executing agent will actually read.
