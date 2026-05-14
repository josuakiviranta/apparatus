---
date: 2026-05-14
description: Two seams in runner.ts and WaitHumanHandler already have the completion/gate signals needed for OS notifications, but neither fires one — leaving the user to poll manually during multi-hour runs.
---

## Core Idea

Pipelines can run for hours. When one finishes or blocks at a human-in-the-loop gate, the user has no way to know without watching the terminal. The daemon's `runner.ts` already fires `child.on("close")` with exit code at run completion; `WaitHumanHandler.execute()` already holds the gate prompt before blocking. Both seams exist — neither fires an OS notification. One thin helper function wired into these two spots would close the gap entirely.

The note driving this: *"There should be a notification feature when pipeline is done for user. User might not be constantly watching the pipeline run because those can run for hours. However there should be a notification message when pipeline have finished the run or hits human in the loop gate that needs human decision making."*

## Why It Matters

This is solo-developer tooling for one machine. The vision is "delegating to someone who already understands the shape of the problem" — but that delegation breaks down if the developer has to actively babysit the run to know when it needs them. The pipeline is the web; the human is the spider. The spider should be able to leave and return only when there's something to eat.

macOS Notification Center is always available via `osascript -e 'display notification "..." with title "..."'` — zero new dependencies, no npm packages, no cross-platform abstraction needed. This is a personal tool; one machine; one platform call.

The two injection points identified in the source:

- **`src/daemon/runner.ts:child.on("close")`** — The daemon already has pipeline name (from `task.args`), project path (`resolveProjectFromArgs`), and exit code. A notification with title `apparat` and body `"[pipeline] finished — exit [code]"` fires here.
- **`src/attractor/handlers/wait-human.ts:WaitHumanHandler.execute()`** — The gate prompt is expanded and choices are known before `this.interviewer.ask()` blocks. Notification body = `"Gate: [truncated prompt] — [choices]"`. The pipeline name is derivable from `meta.dotDir` (the pipeline folder basename).

`HandlerExecutionContext` does not currently carry `pipelineName`. It does carry `projectDir` and `dotDir`. The pipeline name is `path.basename(meta.dotDir)` — sufficient for a useful notification body without schema changes.

## Revised Implementation Steps

1. Add `src/lib/notify.ts` — export `notifyUser(title: string, body: string): void`. On macOS: `execSync("osascript -e ...")` wrapped in try/catch so notification failure is never fatal. On non-macOS: no-op.

2. In `src/daemon/runner.ts`, inside `child.on("close", ...)`, after `closeRun(...)` resolves, call `notifyUser("apparat", `${pipelineName} — ${exitCode === 0 ? "done" : "failed"} (${projectName})`)`. Derive `pipelineName` from `task.args` (already available); derive `projectName` as `path.basename(projectRoot ?? "")`.

3. In `src/attractor/handlers/wait-human.ts`, after the prompt and choices are resolved (lines where `prompt` and `choices` are finalized), call `notifyUser("apparat — gate", `${truncate(prompt, 60)} [${choices.join(" / ")}]`)`. Import `path` to derive pipeline name from `this.dotDir` basename.

4. Add a unit test for `notifyUser` verifying: (a) macOS path calls `osascript` with correct args, (b) errors are swallowed, (c) non-macOS is a no-op. Mock `execSync` and `process.platform`.

5. Manually verify end-to-end: run a short pipeline on macOS, confirm notification appears at completion; run a gate pipeline, confirm notification appears when the gate blocks.