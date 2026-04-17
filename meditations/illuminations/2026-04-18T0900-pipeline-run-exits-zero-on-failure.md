---
date: 2026-04-17
status: open
description: pipelineRunCommand exits 0 on engine failure, so the heartbeat daemon records every failed pipeline run as successful — the JSONL trace knows the truth but the process exit code doesn't.
---

## Core Idea

`pipelineRunCommand` in `src/cli/commands/pipeline.ts` returns `Promise<void>` and calls no `process.exit` when the pipeline engine fails. The process exits 0 by default. This is explicitly documented in `specs/2026-04-17-refine-run-history-and-failure-tip-design.md` (line: "No `process.exit` is called for engine failure; the CLI terminates with exit code 0 by default") — the refine-tip spec noticed it but scoped it out. The daemon runner in `src/daemon/runner.ts` records task outcome via `exitCode` from `child.on("close", (code) => ...)` and passes it to `closeRun()`. Because `ralph pipeline run` always exits 0, `closeRun` always records success — regardless of what the engine actually did.

The JSONL trace at `~/.ralph/runs/<runId>/pipeline.jsonl` IS the accurate record. It contains every node outcome including failures. But nothing reads the trace to inform the process exit code. Two truth sources exist; they disagree.

## Why It Matters

The heartbeat system (`ralph heartbeat pipeline workflow.dot --every 60`) is the primary unattended pipeline execution path. Every heartbeat-driven pipeline run routes through `runTask()` in `runner.ts`, which captures exit code and calls `closeRun(task.id, runId, endedAt, exitCode)`. `ralph heartbeat list` and `ralph heartbeat watch` display run status from that stored exit code. Since the exit code is always 0, every pipeline run shows as successful — including runs where agents exhausted retries, nodes timed out, or the graph reached an error terminal. A developer monitoring heartbeat tasks sees a green history while the pipeline has been silently failing for hours or days.

The contrast with `pipelineValidateCommand` is instructive: `validateCommand` explicitly calls `process.exit(code)` with the result of validation. The engine runner has no equivalent. And the pre-engine guards inside `pipelineRunCommand` (missing file, invalid DOT, missing inputs, headless-safe rejection) DO call `process.exit(1)` — those failures are correctly reported. Only engine-level failures (the vast majority of real failures in production) exit 0.

Shell composition breaks identically: `ralph pipeline run workflow.dot && do_next_step` always runs `do_next_step`. CI scripts that call `ralph pipeline run` in a `run:` step will never fail the build from engine failure.

## Revised Implementation Steps

1. **Set `process.exitCode = 1` after engine failure in `pipelineRunCommand`.** The refine-tip spec's analysis of the failure path is precise: inside the `try` block, after `runPipeline` resolves, set `let pipelineFailed = result.status !== "success"`. In the `finally` block, after `await waitUntilExit()`, add `if (pipelineFailed) process.exitCode = 1`. Using `process.exitCode` (not `process.exit(1)`) avoids cutting off async cleanup while still propagating the signal to the parent process. This is the canonical Node.js pattern for "exit non-zero without forcing an immediate exit."

2. **Verify `closeRun` behavior is now correct for heartbeat tasks.** After step 1, `runner.ts`'s `child.on("close", (code) => ...)` will receive `code = 1` for failed pipeline runs. `closeRun` stores this. Confirm that `ralph heartbeat list` and `ralph heartbeat watch` correctly read the stored exit code and display failed runs as failed. No changes to `runner.ts` or `state.ts` should be needed — the exit code propagation is the only gap.

3. **Add a failing test in `src/cli/tests/pipeline.test.ts`.** The existing test suite likely runs a pipeline and checks the Ink output, but probably does not assert `process.exitCode`. Add one assertion: run a pipeline that routes to a failed terminal (use an existing fixture or create a minimal one with an agent node that returns `agent.success=false` with no retry), then assert `process.exitCode === 1` after `pipelineRunCommand` resolves. This pins the behavior against regression.

4. **Do not change exit code on `--resume` of a successful pipeline.** If the user runs `--resume` and the already-completed pipeline exits `"success"`, exit code must remain 0. The checkpoint-based `--resume` path short-circuits before calling `runPipeline` if the pipeline already completed — verify this is the case and confirm exit 0 is preserved.

5. **Update `specs/commands.md` under `ralph pipeline run`.** The current spec says nothing about exit codes. Add: "Exit behavior: exits 0 on success, 1 on engine failure (any `result.status !== 'success'`). Pre-engine guard failures (file not found, invalid DOT, missing inputs, headless-safe rejection) also exit 1. Callers — including `ralph heartbeat pipeline` — can rely on exit code to determine whether the pipeline succeeded."
