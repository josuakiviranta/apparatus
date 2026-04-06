# run-scenarios Lacks the Escape Hatch It Mandates

## Core Idea

The run-scenarios implementation plan (Chunk 1, Task 1) adds a `RALPH_TEST_CMD` env-var override to `meditate.ts` specifically to enable subprocess testing without a live Claude session. But `runScenarioSession` in that same plan hardcodes `spawn("claude", args, ...)` with no equivalent override. The lesson was applied retroactively to the old command and omitted from the new one being written from scratch at the same moment.

## Why It Matters

The `T1900` illumination diagnosed the core problem: session orchestration is untested because the subprocess is hardcoded. The plan's fix — export the function, add `RALPH_TEST_CMD` override, write vitest scenario tests with stub scripts — is correct. But the plan then adds `runScenarioSession` in Task 7 with the same hardcoded `spawn("claude", ...)` it just finished fixing in meditate.

The evidence is in two places. First, `docs/superpowers/plans/2026-04-05-run-scenarios.md` Task 9 creates `scenario-tests/test-run-scenarios.sh`, which calls `node dist/cli/index.js run-scenarios "$TMP_PROJECT" --all`. This invokes the full command, which calls `runScenarioSession`, which calls real Claude. The companion script `test-meditate-session.sh` runs vitest — it never spawns Claude. The asymmetry is silent in the plan.

Second, the meditate test suite (Task 2 in the plan) adds a `runMeditationSession` describe block with stub scripts via `process.env.RALPH_TEST_CMD`. No equivalent describe block exists or is planned for `runScenarioSession`. The result: `runMeditationSession` gains scenario-level test coverage; `runScenarioSession` ships uncovered, despite being designed after the lesson was already written down.

`meditate-create.ts` is the third data point: it also hardcodes `spawn("claude", ...)` with no override, and has no scenario-level tests. All three non-interactive session runners — meditate, meditate-create, run-scenarios — manage subprocess invocation independently, so the escape hatch must be explicitly added to each one. Without shared infrastructure, the pattern has to be consciously transplanted every time. It wasn't.

## Revised Implementation Steps

1. **Add `RALPH_TEST_CMD` override to `runScenarioSession` before writing any other run-scenarios code.** Replace `spawn("claude", args, ...)` with `spawn(process.env.RALPH_TEST_CMD ?? "claude", args, ...)`. This is a one-line change, identical to what Task 1 does for meditate. Do it in the same commit that creates `run-scenarios.ts`.

2. **Add a `runScenarioSession` describe block to `run-scenarios.test.ts`, parallel to the meditate Task 2 tests.** At minimum: a stub that exits 1 emits a stderr warning; a stub that emits a `tool_use` stream line produces `→ [tool]` output; a stub that exits 0 does not emit a warning. These three tests mirror exactly what the plan writes for meditate. They should be in the same PR.

3. **Rewrite `test-run-scenarios.sh` to run vitest, not the live command.** Replace the `node dist/cli/index.js run-scenarios` invocation with `npx vitest run src/cli/tests/run-scenarios.test.ts --reporter=verbose`, matching `test-meditate-session.sh`. The scenario test's job is to confirm the feature is tested end-to-end through the test suite, not to invoke real Claude.

4. **Extract a shared `spawnClaudeSession` utility** — either in `src/cli/lib/claude-session.ts` or as a minimal exported wrapper — that centralizes the `RALPH_TEST_CMD ?? "claude"` logic and the stream-json stdout parser. All three non-interactive session runners (meditate, meditate-create, run-scenarios) duplicate this logic with minor variations. Each copy introduces independent bugs (`catch {}`, missing exit code check, missing tool indicator). A shared function fixes all three at once and makes every future session runner correct by default.
