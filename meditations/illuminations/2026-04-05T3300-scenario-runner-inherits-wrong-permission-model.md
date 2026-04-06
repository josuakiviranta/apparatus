# Scenario Runner Inherits the Wrong Permission Model

## Core Idea

Ralph has two patterns for non-interactive Claude sessions: the constrained pattern (`meditate.ts` — `--permission-mode dontAsk` + explicit `--allowedTools`) and the unconstrained pattern (`meditate-create.ts`, `plan.ts` — `--dangerously-skip-permissions`). The run-scenarios design spec says it "follows the `meditate-create.ts` pattern," meaning it will use `--dangerously-skip-permissions`. But run-scenarios has the runtime characteristics of `meditate.ts` — unattended, sequential, potentially 25 minutes, no user in the loop — not of meditate-create. The exemplar has the wrong permission model for the use case, and the plan doesn't name this distinction.

## Why It Matters

The permission model choice is load-bearing in both existing commands. `meditate.ts` runs as a background daemon with no oversight; its `--allowedTools` list (exactly 6 MCP tools) is the guarantee that the autonomous agent cannot write source code, execute bash, or make HTTP requests. The constraint makes the loop safe to run unattended. `meditate-create.ts` and `plan.ts` use `--dangerously-skip-permissions` because phase 1 is a short kickoff followed immediately by a user-supervised interactive session — if Claude does something unexpected, the user is there for phase 2 to redirect.

`run-scenarios` runs sequentially through N unattended Claude sessions, each reading a bash script, executing it, and writing a report. The user is not present during any of this. When Task 7 of `docs/superpowers/plans/2026-04-05-run-scenarios.md` writes `runScenarioSession`, the implementing agent will reach for `buildMeditateCreateKickoffArgs` as the named exemplar and copy `--dangerously-skip-permissions`. The resulting scenario Claude agent will have unrestricted access to bash, the filesystem, and network tools — unattended, for every scenario selected, without the user able to intervene.

The risk is not theoretical. The scenario runner's `PROMPT_scenario.md` hasn't been written yet. A malformed or ambiguous prompt could cause Claude to modify source files (trying to "fix" what it found), delete intermediate artifacts, or make network calls during what the user expects to be a pure analysis phase. With `--dangerously-skip-permissions` and no MCP server providing constrained tools, there is no mechanism to prevent this. With `--permission-mode dontAsk` and `--allowedTools bash,write_file,read_file`, the agent can run the script and write the report and nothing else.

The gap has a compounding effect: the 19 prior illuminations correctly diagnosed missing SIGINT handling, missing `RALPH_TEST_CMD`, missing sort, and missing read-path. But none of them examined whether the agent running the scenario should be constrained at all. The plan's one-line "following the `meditate-create.ts` pattern" resolved the permission question implicitly in the wrong direction.

## Revised Implementation Steps

1. **Do not copy `buildMeditateCreateKickoffArgs` for `runScenarioSession`.** The meditate-create pattern is wrong for an unattended loop. Write `buildScenarioArgs` separately, mirroring `buildMeditationArgs` from `meditate.ts` instead. Use `--permission-mode dontAsk` rather than `--dangerously-skip-permissions`.

2. **Define an explicit `--allowedTools` list for the scenario Claude agent.** The scenario agent needs: `bash` (to run the script), and whichever built-in tool writes files (likely `write_file` or equivalent). Enumerate these explicitly. If `PROMPT_scenario.md` is written first (as T2500 recommends), the allowed tools list follows directly from the tools the prompt instructs Claude to use. Write the prompt first; derive the `--allowedTools` list from it.

3. **Add a vitest test for `buildScenarioArgs` that asserts `--permission-mode dontAsk` is present and `--dangerously-skip-permissions` is absent.** The test for `buildMeditationArgs` in `illumination-server.test.ts` can serve as the pattern. Asserting the absence of `--dangerously-skip-permissions` makes the permission choice explicit and regression-proof.

4. **Document the two patterns in a comment above each `buildArgs` function.** One line: `// Constrained: unattended loop, no user oversight` above `buildMeditationArgs` and `buildScenarioArgs`. One line: `// Unconstrained: kickoff phase, user present in phase 2` above `buildMeditateCreateKickoffArgs`. The current code has zero comments explaining why the patterns differ. The implementing agent reading the file won't know which to copy.

5. **Add the permission model choice as an explicit decision in the run-scenarios plan.** Task 7 should specify: "use `--permission-mode dontAsk` — do not copy `--dangerously-skip-permissions` from meditate-create." One sentence. It prevents the wrong copy, which is otherwise the path of least resistance.
