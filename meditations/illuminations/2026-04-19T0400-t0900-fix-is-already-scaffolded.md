---
date: 2026-04-18
status: open
description: The printRefineTip implementation introduced pipelineFailed into pipeline.ts's finally block — T0900's exit-code fix is one statement away, but T0900's own implementation steps don't know this and will generate a plan for work that is 90% done.
---

## Core Idea

T0900 (`pipeline-run-exits-zero-on-failure`) is still open. Its implementation steps describe adding a `pipelineFailed` boolean, setting it after engine failure, and reading it in the `finally` block. All of that already exists in `src/cli/commands/pipeline.ts` — introduced by the `printRefineTip` implementation, which landed after T0900 was written. The current `finally` block reads:

```ts
if (pipelineFailed) printRefineTip(dotFile);
```

The missing line is one statement below that:

```ts
if (pipelineFailed) process.exitCode = 1;
```

That is the entire T0900 fix. The boolean, the try-block assignment, the finally-block placement — all present. Only the `process.exitCode` assignment is absent.

## Why It Matters

If T0900 is dispatched through the illumination-to-implementation pipeline today, the verifier will correctly confirm it is still open, the explainer will produce a before/after block, and the design writer will write a spec — for a change that reduces to one line in one file. The plan writer will structure it as a TDD chunk with a new test, a code change, a commit. All of that is valid, but the overhead is disproportionate to what's missing.

More importantly: T0900's own implementation steps say "inside the `try` block... set `let pipelineFailed = false`; in the `finally` (after `await waitUntilExit()`), add `if (pipelineFailed) process.exitCode = 1`." A plan author following those steps will add a duplicate boolean declaration, which TypeScript will reject as a re-declaration in the same scope. The implementer will spend time diagnosing a compile error that reveals the work is already done.

The `specs/commands.md` update (T0900 step 5) is also still missing — the `ralph pipeline run` entry has no exit-code documentation. That is the other half of the remaining work.

The heartbeat consequence is real and still active: `ralph heartbeat pipeline workflow.dot --every 60` will record every failed pipeline run as successful until this ships. The JSONL trace is accurate; the daemon's stored exit code is not.

## Revised Implementation Steps

1. **Apply the one-line patch to `src/cli/commands/pipeline.ts`.** In the `finally` block, immediately after `if (pipelineFailed) printRefineTip(dotFile)`, add:
   ```ts
   if (pipelineFailed) process.exitCode = 1;
   ```
   Do not add a new `pipelineFailed` variable — it already exists at the top of the outer try/finally scope. Do not call `process.exit(1)` — using `process.exitCode` avoids cutting off async cleanup while still propagating the exit signal to the parent process and the heartbeat daemon's `child.on("close", (code) => ...)` handler.

2. **Add a test in `src/cli/tests/pipeline.test.ts`.** The test must assert that after `pipelineRunCommand` resolves on an engine-failure fixture, `process.exitCode` equals 1. Verify the success path leaves `process.exitCode` at 0 (or undefined). The existing `pipeline-headless.test.ts` and `pipeline.test.ts` likely cover the Ink-renderer paths but not exit codes — search both for `exitCode` before adding to confirm no duplication.

3. **Update `specs/commands.md`.** Under `ralph pipeline run`, add an exit-behavior paragraph: "Exits 0 on success, 1 on engine failure (`result.status !== 'success'`). Pre-engine guard failures (file not found, invalid DOT, missing inputs, headless-safe rejection without TTY) also exit 1. Shell callers and the heartbeat scheduler can rely on this."

4. **Archive T0900 after step 1 lands.** The illumination's analysis is correct; its implementation steps are now stale because they describe adding the boolean from scratch. Once the `process.exitCode` line is committed, T0900 is fully implemented. No separate plan or design doc is needed — the fix is too small to warrant one.
