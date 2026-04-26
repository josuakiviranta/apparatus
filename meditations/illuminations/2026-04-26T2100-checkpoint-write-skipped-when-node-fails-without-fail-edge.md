---
date: 2026-04-26
status: archived
description: The pipeline engine writes checkpoint.json only after a successful node advance, after fail-edge routing, after retry, or before exit — never on raw node failure. A node that crashes (API timeout, exception) without a declared fail-edge terminates with no checkpoint, making `--resume` impossible for the most common failure mode.
archived_at: 2026-04-26
reason: engine.ts:338 already writes checkpoint pointing at next node before it executes
---

## Core Idea

`src/attractor/core/engine.ts` calls `saveCheckpoint` at exactly five points:

- `:203` before exit-node finalisation
- `:294` after a retry attempt (only when `retryCount < maxRetries`)
- `:313` after fail-edge routing
- `:332` after `loop_restart`
- `:338` before the next node executes (normal advance)

There is no checkpoint write at node-start. There is no checkpoint write when a node fails with no fail-edge defined. The engine simply terminates at `:310` and returns failure.

Concrete failure observed 2026-04-26: `implement` node hit `API Error: Stream idle timeout` mid-turn. No fail-edge declared on that node. Engine terminated at `:310`. `~/.ralph/runs/7e7ba11b/checkpoint.json` did not exist. `ralph pipeline run … --resume` had nothing to load. The user lost ~8 minutes of agent work and re-ran from scratch.

The fix: write a checkpoint at node-start, recording the about-to-execute node id. On failure without fail-edge, the checkpoint already exists and points at the failed node. `--resume` retries that node from a clean slate (idempotent by agent-node design — agents re-run is the normal pattern).

## Why It Matters

Stream-idle timeouts and transient API errors are the dominant pipeline-failure mode in practice. Every long-running agent node is exposed. Without checkpoint-on-failure, `--resume` is an advertised feature that does not work for the case users hit most often.

This is independent of the larger namespace redesign in T2000. It can ship in either layout. Shipping it first reduces user-visible pain on the existing layout while T2000 is being designed.

The change is small in scope: one new `saveCheckpoint` call at node-start in `engine.ts`, plus a test that simulates a node throw without fail-edge and asserts the checkpoint exists.

## Breaking Changes (verify each before landing)

**Code:**
- `src/attractor/core/engine.ts` — add `saveCheckpoint` call at node-start (before tool/agent invocation). Single new write site.
- Confirm checkpoint schema (`CheckpointState` in `src/attractor/checkpoint.ts`) already supports recording `currentNode = <about-to-execute>` semantics. It does — line 338 already uses this shape.

**Tests:**
- New test in `src/attractor/tests/engine.test.ts` — node throws, no fail-edge, assert checkpoint.json exists with `currentNode = failedNodeId`.
- Existing tests at `src/attractor/tests/engine.test.ts:136, 275, 301` use checkpoint via injected temp `logsRoot` — should still pass; verify no test asserts "no checkpoint after failure" (would be wrong-spec assertion).
- `src/cli/tests/pipeline-failure-reason.test.ts` — re-run; the failure-reason path may change if checkpoint now exists.

**Docs:**
- `README.md:72` — current text says "checkpoints after every node advance". Update to "checkpoints at every node-start and node-advance".
- `specs/pipeline.md:83, 180, 198` — same correction.
- `specs/architecture.md:136` — same.
- `specs/commands.md:167` — `--resume` semantics: now recovers from raw node-throw, not just fail-edge-routed failures.

**Behavioural notes:**
1. Idempotency requirement on tool nodes already documented (`README.md:72`). Agent nodes are inherently idempotent (re-prompt is the normal pattern). Confirm no tool node in `pipelines/scripts/` assumes "checkpoint only after success" — none should, but verify.
2. A node that fails on its first millisecond (e.g. malformed agent config) now leaves a checkpoint pointing at it. `--resume` will retry indefinitely unless the user fixes the underlying problem. Document this — checkpoint-on-failure is not a substitute for `max-retries`.
3. The retry-counter semantics at `:294` now interact with node-start checkpoint. Verify `nodeRetries` is not double-counted when both writes fire for the same node-attempt.

**This list is not authoritative.** Re-run the breaking-changes audit before implementation: grep for `saveCheckpoint`, `loadCheckpoint`, `CheckpointState`, `currentNode`, `nodeRetries` across `src/`, `specs/`, and tests. Any caller not listed above is a regression risk. Specifically check whether any test asserts "no checkpoint exists after failure" — that assertion becomes wrong with this change.

## Revised Implementation Steps

1. **Confirm `CheckpointState` shape supports node-start semantics.** Read `src/attractor/checkpoint.ts`. The schema already records `currentNode = next-to-execute`; node-start is the same shape with no semantic change.
2. **Add the node-start `saveCheckpoint` call** in `engine.ts` immediately before node execution begins (after edge resolution that lands on the node, before tool/agent spawn).
3. **Write a failing test** in `engine.test.ts`: a node that throws synchronously, no fail-edge, no retries left. Assert `checkpoint.json` exists at the injected `logsRoot` with `currentNode = throwingNodeId`. Run; confirm red.
4. **Make the test green** by ensuring step 2 fires before the throw site.
5. **Audit existing tests.** Grep `engine.test.ts` and `pipeline*.test.ts` for any assertion that expects checkpoint absence after failure. If any exist, they encode the bug — flip the assertion.
6. **Update docs** at the four file:line locations above.
7. **Smoke-test on a real failure.** Force a deliberate throw (e.g. malformed agent prompt, missing `tool_command`), confirm `--resume` recovers cleanly.
