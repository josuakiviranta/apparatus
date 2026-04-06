# Meditate Orchestration Is the Untested Core

## Core Idea

`meditate.ts` has thorough unit tests for every setup/teardown utility: PID management, gitignore patching, MCP config writing, arg building. But `runMeditationSession` — the async function that spawns the subprocess, parses the stream-json output, coordinates cleanup, and drives all user-visible behavior — has zero test coverage. The test pyramid is inverted: the stable infrastructure is covered; the complex orchestration that uses it is not. Simultaneously, the stream parser swallows all tool-use events and all JSON parse errors silently, making a failed session visually indistinguishable from a successful one.

## Why It Matters

Every tested function in `src/cli/tests/meditate.test.ts` is preparation: write a PID file, append a gitignore, build an args array, create a config. These tests confirm that the launch pad is correct. What they cannot confirm is whether the rocket fires.

The stream parser in `runMeditationSession` (`meditate.ts` lines ~100–125) has two specific silent-failure modes. First, the `catch {}` inside the JSON parse loop discards any line that is not valid JSON without writing anything to stdout or stderr. If the stream produces garbage, the user sees nothing. Second, the close handler (`child.on("close", ...)`) resolves the promise without checking the exit code. When `claude` exits with code 1 (auth failure, tool error, rate limit), the promise resolves, cleanup runs, and the terminal returns — identically to success. The only difference is that no illumination file appeared, and the user doesn't know why.

The `scenario-tests-catch-what-unit-tests-miss` lens applies directly: a scenario test for `meditateCommand` — stub the `claude` binary, point it at a real temp project, assert a file appears in `meditations/illuminations/` — would catch exactly these failure modes. It does not exist.

There is a secondary observation: `plan.ts` and `new.ts` emit `\n→ [tool] ${name}\n` to stdout for every tool-use event during their headless phase. Meditate's parser skips tool-use events entirely. The meditate prompt (`PROMPT_meditation.md`) calls many tools before writing anything — `project_tree`, multiple `read_file` calls, `list_meta_meditations`, `read_meta_meditation`. On a large project this exploration phase takes 2–3 minutes. The user sees nothing. The only difference between "working" and "hung" is time elapsed.

## Revised Implementation Steps

1. **Add an env-var override for the claude binary in `runMeditationSession`.** Replace the hardcoded `"claude"` in the `spawn` call with `process.env.RALPH_TEST_CMD ?? "claude"`. This is the prerequisite for any test that exercises the orchestration layer.

2. **Write a scenario test in `src/cli/tests/meditate.test.ts` that stubs the claude binary.** The stub script writes minimal valid stream-json to stdout (a `result` line, a `tool_use` event, and an `assistant/text` block), then exits 0. Assert that `meditateCommand` on a real temp dir: (a) creates the illumination dir, (b) exits cleanly, (c) emits the text block to stdout. This is the scenario test that proves the launch sequence works end-to-end.

3. **Add exit code logging in the close handler.** After `cleanupMcpConfig`, check the exit code: if `code !== 0`, write a visible warning to stderr — `"Warning: claude exited with code ${code}"`. Do not throw; the meditate command is already fire-and-forget. Just surface the signal.

4. **Add tool-use progress indicators to the stream parser**, matching the plan/new pattern. When a content block has `type === "tool_use"`, write `\n→ [tool] ${block.name}\n` to stdout. The user gets feedback during the exploration phase instead of silence. This is a one-line addition to the existing loop.

5. **Add a targeted unit test for the tool-use indicator.** Extract the per-line parse-and-emit logic into a named exported function (e.g., `processStreamLine(line: string, stdout: NodeJS.WriteStream): void`). Test it with synthetic stream-json input: assert text blocks are written, assert `→ [tool]` is emitted for tool_use events, assert empty/malformed lines don't throw. This separates parsing logic from subprocess wiring, making both independently testable.
