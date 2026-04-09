---
date: 2026-04-09
description: The four April 12 bugs are not independent — fixing the prompt (1500) before the engine (0900, 1300) exposes loop pipelines to broken checkpoints; the engine bugs must ship first or the prompt fix becomes a trap.
---

## Core Idea

The four bugs identified today have a dependency order that none of the individual illuminations states. Bug 1500 (prompt misdefines `goal_gate`, omits `loop_restart`) acts as an accidental shield for bugs 0900 and 1300: because Claude cannot author a `loop_restart` pipeline, no user-run pipeline will loop, so the unbounded checkpoint growth (0900) and the resume re-execution (1300) are unreachable. Fix 1500 first — ship a prompt that correctly documents `loop_restart` — and Claude-authored looping pipelines will immediately produce corrupt checkpoints and silent re-execution on resume. The prompt fix is a trap if the engine bugs are still open.

## Why It Matters

`the-agentic-loop-is-a-graph` names resumability as a first-class property of graph-based loops. The engine checkpoint mechanism exists to provide exactly this. But the checkpoint is wrong in two ways simultaneously:

- `currentNode` is saved as the node that just completed, not the node to run next (1300). Resume re-executes the last successful node.
- `completedNodes` is a bag that grows without bound in any loop (0900). After 500 cycles, the checkpoint is hundreds of kilobytes of repeated node IDs.

Neither bug surfaces in any existing scenario test. `gate_test.dot`, `work_test.dot`, and `smoke.dot` are all linear pipelines — one pass, no back-edges, no resume test. The 69KB `ralph-engine-test-5zoWIW/checkpoint.json` sitting untracked at the project root is direct evidence: a `work` node visited hundreds of times, producing a checkpoint the engine itself generated during some earlier test run. The `sessionId: "s1"` in `work/status.json` fingerprints it as a `fakeRunLoop` artifact, confirming this came from a test that was not cleaned up — a test that has since been removed or modified, leaving the ghost behind.

The scenario suite has three gaps that together mean none of the four bugs are caught end-to-end:
1. No `--resume` sub-test in any scenario.
2. No `loop_restart` pipeline in any scenario.
3. No `pipeline create` scenario (the two-phase Claude session is never tested outside unit mocks).

Bug 1100 (missing `which claude` guard in `pipelineCreateCommand`) is independent of loop semantics but shares the same scenario coverage gap — `pipeline create` is never run in any scenario test.

## Revised Implementation Steps

1. **Fix the engine checkpoint timing first (1300).** In `engine.ts`, in the Advance block, compute `nextEdge` before calling `saveCheckpoint`. Save with `currentNode: nextEdge.to`. This is a four-line change. The retry-path checkpoint (`currentNode: node.id` when the node failed) stays unchanged — that semantics is correct.

2. **Fix the completedNodes bag (0900) in the same commit.** Replace `completedNodes = [...completedNodes, node.id]` with a deduplication guard: only append if `node.id` is not already present. Add `visitCounts: Record<string, number>` to `CheckpointState` if per-node visit history is needed downstream. Commit 0900 and 1300 together — they interact and fixing only one leaves the other hidden.

3. **Add a resume scenario to `test-attractor-pipeline.sh`.** After running `work_test.dot` to completion, write a synthetic checkpoint for a mid-pipeline failure (e.g., after `start` completes, before `write`), then run `ralph pipeline run work_test.dot --resume --project "$REPO_ROOT"` and assert exit 0. This is the only test that validates the round-trip: checkpoint-written → resume-reads → correct-next-node.

4. **Add `ralph-engine-test-*/` to `.gitignore` and remove the leaked directory.** The artifact at the project root is evidence of a test that didn't clean up. Add the ignore pattern, verify `engine.test.ts` has `afterEach(() => rmSync(dir, { recursive: true }))` for every test that creates a `dir`, and delete `ralph-engine-test-5zoWIW/` manually.

5. **Fix the prompt (1500) last.** Only after steps 1–2 are merged: update `PROMPT_pipeline_create.md` with correct `goal_gate` semantics and a `loop_restart` section. The prompt fix is safe to ship once the engine correctly handles looping pipelines.
