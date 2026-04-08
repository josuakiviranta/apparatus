---
date: 2026-04-06
description: 'The plan''s architecture header points at `meditate-create.ts` as the pattern for `runScenarioSession`.'
---

# Exemplar Mismatch Is a Category Error, Not a Pointer Mistake

## Core Idea

The plan's architecture header points at `meditate-create.ts` as the pattern for `runScenarioSession`. This is not a minor naming slip — it is a category error. `meditate-create.ts` orchestrates a 10-second non-interactive kickoff *followed by a user-supervised interactive TUI*. The scenario runner is a 20-minute unattended sequential loop with no user in the loop. The `interactive-vs-non-interactive-agent-work` meditation names this exactly: confusing the two modes is "a mistake in both directions." Copying the interactive kickoff pattern into an unattended runner pre-determines four of the six predicted bugs before a single line of Task 7 is written.

## Why It Matters

The four bugs that cascade directly from the wrong exemplar choice:

1. **Permission model.** `meditate-create.ts` uses `--dangerously-skip-permissions` because a human takes over 10 seconds in — loose permissions for a brief kickoff are acceptable. `meditate.ts` uses `--permission-mode dontAsk` with explicit `--allowedTools` because it runs unattended indefinitely. An executor deriving from the correct exemplar copies the right flag automatically; one deriving from the wrong exemplar copies the wrong flag with equal confidence.

2. **SIGINT handler.** `meditate-create.ts` has no cleanup handler — the session is short-lived and the user is present. `meditate.ts` registers `process.once("SIGINT", cleanup)` and `process.once("SIGTERM", cleanup)` with `child.kill("SIGTERM")` because a 20-minute loop must be interruptible. An executor deriving from `meditate.ts` sees this pattern directly at lines 122–127 and replicates it. An executor deriving from `meditate-create.ts` never sees it.

3. **Exit code check.** Neither exemplar has this yet — it is being added in Task 2. But Task 2 adds it to `meditate.ts`. An executor told to derive Task 7 from the post-Task-2 `meditate.ts` will inherit this check. An executor deriving from `meditate-create.ts` sees a `child.on("close", () => resolve(sessionId))` with no code inspection — and replicates that instead.

4. **Stream parser.** `meditate-create.ts` already has the `tool_use` handler. `meditate.ts` gets it in Task 2. After Tasks 1–2 complete, both files have it — this bug self-corrects regardless of exemplar choice. But it only self-corrects if the executor re-reads `meditate.ts` after Task 2 rather than working from pre-Task-2 state.

The `gene-transfusion` pattern is explicit: "The key ingredient is not the exemplar alone — it is the exemplar paired with tests." Both exemplars exist. The plan chose the wrong one. The test suite in Task 2 is the validation suite that travels with `meditate.ts`. Everything is already in place — the plan just points at the wrong source.

Two bugs remain that do not cascade from the exemplar: `RALPH_TEST_CMD` override (not in either exemplar — net-new in Task 2) and `discoverScenarios` sort (unrelated to the session runner entirely). These require explicit amendment regardless of exemplar choice.

## Revised Implementation Steps

These are the four amendments to make in `docs/superpowers/plans/2026-04-05-run-scenarios.md`. They supersede the six-amendment list in T0800 by collapsing four amendments into one root-cause fix.

1. **Architecture header: change the exemplar reference.** Replace "follows the `meditate-create.ts` non-interactive session pattern" with "follows the `meditate.ts` unattended session pattern — derive `runScenarioSession` from `meditate.ts` as it exists after Tasks 1–2, not from the Task 7 code block below." Add to Task 7 Step 0: "Re-read `src/cli/commands/meditate.ts` in full before writing any code in this task."

2. **Task 7: add `RALPH_TEST_CMD` override with three subprocess tests.** `spawn(process.env.RALPH_TEST_CMD ?? "claude", args, ...)`. Add tests: stub exiting 1 emits stderr warning; stub exiting 0 does not; stub emitting a `tool_use` stream line produces `→ [tool]` output. This is not in either exemplar — it must be stated explicitly.

3. **Task 6: add `.sort()` to `discoverScenarios` with an ordering test.** Append `.sort((a, b) => a.name.localeCompare(b.name))` to the `readdirSync` chain. Add a test that writes `test-beta.sh` before `test-alpha.sh` and asserts the result returns alpha first. Without this, scenario ordinals shift silently when the folder changes.

4. **Mark plan `Status: Ready` in the header.** Insert one line after the goal paragraph: `**Status:** Ready — exemplar corrected, amendments applied, safe to execute.` This is both a commit and a signal: the next executor (human or agent) reading this line knows the observation work has been integrated.
