---
date: 2026-04-09
description: The `--resume` flag in `ralph pipeline run` silently starts over instead of resuming because logsRoot is timestamp-based and freshly computed on every invocation — the checkpoint from the interrupted run is never found.
---

## Core Idea

`ralph pipeline run workflow.dot --resume` does not resume. The `logsRoot` is computed as `~/.ralph/runs/<slug>-<new-timestamp>/` on every invocation — a fresh directory that contains no checkpoint. `loadCheckpoint` returns `null`, the `if (cp)` block is skipped, and the pipeline starts from the beginning. No error is raised. The `the-agentic-loop-is-a-graph` lens names resumability as a first-class property of graph-based loops: "resumable from any checkpoint, which means a failure mid-graph is not a full restart." The engine satisfies this property internally. The CLI severs the connection between invocations by generating a fresh address every time.

## Why It Matters

The help text in `src/cli/program.ts` advertises this exact scenario:

```
ralph pipeline run workflow.dot --resume    # continue after Ctrl-C
```

A user follows this instruction after a Ctrl-C. Their pipeline restarts from node one, consuming wall time and API calls spent on work already done, with no indication that the resume found nothing.

Three layers of evidence confirm this is unreachable through normal usage:

1. **The CLI option doesn't exist.** `program.ts` registers `--project` and `--resume` for `pipeline run`. There is no `--logs-root` option. A user has no mechanism to tell a second invocation where the first invocation's checkpoint lives.

2. **Tests hide the bug by construction.** Every `pipelineRunCommand` call in `src/cli/tests/pipeline.test.ts` passes `logsRoot: dir` explicitly — the exact piece the CLI never supplies. The test suite validates the resume codepath in isolation but never tests the CLI → engine handoff with a fresh `opts.logsRoot`.

3. **The engine is silent on missing checkpoints.** In `src/attractor/core/engine.ts`, `loadCheckpoint` returns `null` when the file doesn't exist. The resume block is `if (cp) { ... }` — a missing checkpoint is indistinguishable from a brand-new run. A `--resume` invocation that finds no checkpoint proceeds identically to a first run.

The four April 12 illuminations (0900, 1100, 1300, 1500) orbit engine and prompt bugs. This bug is upstream of all of them: even if the checkpoint logic and prompt were perfect, no CLI-invoked resume would ever reach a checkpoint.

## Revised Implementation Steps

1. **Switch to a stable logsRoot.** Replace the timestamp-based path with a deterministic one:
   ```ts
   const logsRoot = opts.logsRoot
     ?? join(homedir(), ".ralph", "runs", slug);
   ```
   When `--resume` is NOT set, call `rm -rf logsRoot && mkdir -p logsRoot` at the start of `pipelineRunCommand`. When `--resume` IS set, leave the directory as-is. This makes the logsRoot for `workflow.dot` always `~/.ralph/runs/workflow/`, whether resuming or not. Parallel runs of different pipelines remain isolated. Concurrent runs of the same pipeline would collide — document this as unsupported (or use a per-project prefix: `~/.ralph/runs/<project-hash>/<slug>/`).

2. **Emit a warning when resume finds no checkpoint.** In `engine.ts`, after `loadCheckpoint` returns `null` inside the `opts.resume` block, log a warning before starting fresh:
   ```ts
   if (opts.resume) {
     const cp = await loadCheckpoint(opts.logsRoot);
     if (cp) { /* restore */ }
     else { console.warn("[ralph] --resume: no checkpoint found, starting from beginning"); }
   }
   ```
   A silent fallback-to-fresh is always the wrong behavior for a named resume operation.

3. **Add `--logs-root` as a CLI option (optional, for power users).** Let the user override the logsRoot:
   ```
   ralph pipeline run workflow.dot --resume --logs-root ~/.ralph/runs/my-specific-run/
   ```
   This is the escape hatch for cases where the stable slug-based path is wrong — e.g., running the same pipeline against two different projects.

4. **Fix the pipeline test to test the CLI-level handoff.** Add a test to `pipeline.test.ts` that calls `pipelineRunCommand(dotFile, { resume: true })` WITHOUT supplying `logsRoot`, writes a real checkpoint to the computed path before calling, and asserts that `engine.runPipeline` receives `resume: true` with the correct `logsRoot`. This is the only test that can catch a future regression where the logsRoot computation drifts.

5. **Add a `--resume` sub-test to `test-attractor-pipeline.sh`.** After running `work_test.dot` to completion, invoke `ralph pipeline run work_test.dot --resume --project "$REPO_ROOT"` and assert it does NOT call `fakeRunLoop` (all nodes already completed). This is the end-to-end scenario the advertised help text describes.
