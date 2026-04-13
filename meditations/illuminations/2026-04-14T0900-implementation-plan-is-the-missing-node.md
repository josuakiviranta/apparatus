---
date: 2026-04-13
status: open
description: IMPLEMENTATION_PLAN.md is the only file that has reliably converted plans into shipped features, but it has been empty since the state machine completed — nothing in the project's workflow promotes a plan from docs/superpowers/plans/ into it, leaving the development graph broken between "plan written" and "implementation started".
---

## Core Idea

`IMPLEMENTATION_PLAN.md` is the single file that, when populated with chunked tasks, reliably produces shipped features. The illumination state machine is the proof: chunks → TDD → commit → ✅ COMPLETE, all 692 tests passing. The file currently contains only that completion summary — no pending chunks, no active work. Twenty plans live in `docs/superpowers/plans/`, 9 illuminations are open, and the backpressure guard (specified 2026-04-12, flagged in three illuminations, a fully-detailed plan with exact line numbers at `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md`) still does not exist in `src/cli/commands/meditate.ts`. The development graph has a working observe→illuminate→plan path. It has no edge from plan to `IMPLEMENTATION_PLAN.md`.

## Why It Matters

The agentic-loop-is-a-graph lens names the failure precisely: when the graph has no edge between two nodes, traversal stops. `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md` and `IMPLEMENTATION_PLAN.md` both exist on disk, but no pipeline, agent, or documented workflow connects them. `illumination-to-plan.dot` ends at `plan_writer → done`. The illuminate command has no follow-on step. So plans accumulate while `IMPLEMENTATION_PLAN.md` stays dark.

The filesystem-as-memory lens explains why this stalls work across sessions. `IMPLEMENTATION_PLAN.md` was active working memory: its chunk structure (task → steps → commit) was exactly the granularity an agent needs to resume mid-task after a context reset. When it went dark, the project lost its durable working memory. Plans in `docs/superpowers/plans/` are inert — they were written in sessions where the active context was "what needs to be built," but that context does not survive session boundaries. Reading 20 files to reconstruct it is not equivalent.

The current state also demonstrates the exact failure mode the backpressure guard was designed to prevent. The spec sets a threshold of 5. The corpus is now at 9 — this session is generating the 10th illumination. Every session since T0300 has flagged the guard as critical. The guard would have stopped four of those sessions. It hasn't been written because no session started with "populate `IMPLEMENTATION_PLAN.md` first."

Three 2026-04-14 plan files describe work that is already implemented: `ink-native-gate-prompt` (`GateSelector.tsx`, `InkInterviewer` both exist), `store-node-handler` (`StoreHandler` exists), `handler-context-registry-dedup` (`HandlerExecutionContext` typed, dead registry removed). They sit unmarked alongside pending plans. Without status frontmatter, a developer resuming the project cannot distinguish "done, close it" from "pending, start it" without reading every file.

## Revised Implementation Steps

1. **Populate `IMPLEMENTATION_PLAN.md` with the backpressure guard as the sole active chunk.** Copy the two chunks from `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md` directly. Set status to `in-progress`. This is the only step that converts the current observation into scheduled work. Do it before starting any other task in the next session.

2. **Execute the backpressure guard plan.** The implementation is ~40 lines across two files, fully TDD-specified with exact step-by-step instructions. Chunk 1: `countIlluminations()` in `src/cli/commands/meditate.ts`. Chunk 2: guard logic + `--force` flag in `meditateCommand()` and `src/cli/program.ts`. The plan already has the test cases, the line numbers, and the commit messages.

3. **Mark the three already-implemented 2026-04-14 plans as complete.** Add `status: complete` frontmatter to `docs/superpowers/plans/2026-04-14-ink-native-gate-prompt.md`, `2026-04-14-store-node-handler.md`, and `2026-04-14-handler-context-registry-dedup.md`. Verify against the codebase first (all three are confirmed implemented). This pass produces accurate ground truth for the first time.

4. **Add a one-paragraph entry to `AGENTS.md` documenting the promotion step.** "To move a plan to active implementation: copy its chunks into `IMPLEMENTATION_PLAN.md`, set status: in-progress, and start TDD on Chunk 1." The edge between plan and implementation does not need to be automated to exist — it needs to be documented so the next session knows the step.

5. **After completing the backpressure guard, immediately pick the next plan.** The candidates in priority order: illumination auto-commit gap (4 `execSync` blocks in `src/cli/mcp/illumination-server.ts`, plan at `docs/superpowers/plans/2026-04-12-illumination-auto-commit.md`), then `mark_implemented` lifecycle (plan at `2026-04-12-mark-implemented-lifecycle.md`). Both are low-risk, high-correctness-payoff changes under 50 lines each. Promote one immediately when the backpressure guard commits land.
