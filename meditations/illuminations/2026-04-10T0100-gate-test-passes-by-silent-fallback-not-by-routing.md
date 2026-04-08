---
date: 2026-04-08
description: gate_test passes because ConsoleInterviewer gets EOF on a non-TTY pipe and produces an empty answer that falls to default edge selection — the human gate mechanism has never been exercised end-to-end by any test.
---

## Core Idea

`gate_test` passes in `test-attractor-pipeline.sh` because `ConsoleInterviewer` is given a non-TTY stdin (the script pipes output through `tee`). `readline.question` fires immediately with an empty string. `parseInt("") - 1` is `-1`, so `q.options[-1]` is `undefined` and `preferredLabel` becomes `""`. No edge label matches `""`, the fallback picks the alphabetically-first unconditional edge (`done` before `work`), and the pipeline exits successfully. The test output shows `Choice: PASS: gate_test` as a merged artifact — the prompt and the summary line printed on the same cursor position.

The scenario design spec (2026-04-09-attractor-scenario-tests-design.md) lists as its pass criterion: "user saw 'Continue?' prompt, routing followed answer." Neither condition is verified. The test checks exit code 0 only, which is satisfied regardless of what the gate decided.

## Why It Matters

`AutoApproveInterviewer` already exists (`src/attractor/interviewer/auto-approve.ts`) and always picks `options[0]`. It was written for exactly this situation but is not reachable from the CLI — `pipelineRunCommand` unconditionally constructs `new ConsoleInterviewer()`. The mechanism and the test are in the same codebase, separated only by a missing flag.

The `proof-of-work-proof-of-usage` lens applies directly: the test output looks like a verified human gate. It is not. The gate ran. Nobody answered. The pipeline picked an edge anyway, and no failure was raised. The gate test is proof of work (the scenario file exists, the script runs, the exit code is 0) but not proof of usage (the `WaitHumanHandler` → `ConsoleInterviewer` → `selectNextEdge` chain was never driven by an intentional answer).

This matters because `WaitHumanHandler` and `selectNextEdge`'s label-matching logic (Step 2 of four fallback steps) are untested by the scenario that claims to test them. A regression in label normalization or preferred-label matching would not be caught.

## Revised Implementation Steps

1. **Add `--auto-approve` flag to `ralph pipeline run`.** In `src/cli/program.ts`, add `.option("--auto-approve", "use AutoApproveInterviewer (always picks first option)")` to the pipeline command. Pass it through `PipelineRunOptions`. In `pipelineRunCommand`, conditionally instantiate `AutoApproveInterviewer` when the flag is set.

2. **Update `gate_test.dot` to route "Yes" toward the `work` node.** Change the `work` node's `prompt` to something observable — e.g., `"Append gate-test-passed to README.md"`. This gives the test a verifiable side effect, not just an exit code.

3. **Update `test-attractor-pipeline.sh` to run gate_test with `--auto-approve`.** The flag makes `ConsoleInterviewer` unnecessary and drives the gate with an intentional "Yes" answer. The test then validates that the "Yes" branch was taken (README contains `gate-test-passed`).

4. **Add a second gate_test variant that sends `2` via piped stdin.** Use `echo 2 | ralph pipeline run gate_test.dot` (no `--auto-approve`). This exercises the "No" branch: the pipeline should route to `done` directly without touching the README. Assert the README does NOT contain `gate-test-passed`.

5. **Add a unit test for `WaitHumanHandler` with a mock interviewer that returns `"No"`.** Verify `outcome.preferredLabel === "No"` and that `selectNextEdge` resolves the correct edge in a two-branch graph. This is the gap that the scenario test cannot fill alone.
