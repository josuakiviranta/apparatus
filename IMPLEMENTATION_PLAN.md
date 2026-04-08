# Attractor Pipeline Engine Implementation Plan

**Goal:** Add a DOT-graph pipeline engine (Attractor) to ralph-cli so users can define agentic workflows as `.dot` files and run them with `ralph pipeline run <dotfile>`.

**Architecture:** The engine lives in `src/attractor/` and is bundled into the existing ralph binary. It parses a supported DOT subset into a typed `Graph`, validates it, applies transforms, then executes nodes via typed handlers. The `runLoop()` function is refactored to return `LoopResult` and accept `AbortSignal` so handlers can drive it without taking over the process.

**Tech Stack:** TypeScript, Node.js, vitest, tsup, commander. No new npm packages — DOT parsing is hand-rolled (the subset is small enough).

**Status:** Complete. All 13 tasks across 7 chunks implemented and verified.

---

## Completed

| Chunk | Tasks | What Was Done |
|-------|-------|---------------|
| 1 — Types + loop.ts Refactor | 1-2 | Shared types (`Node`, `Edge`, `Graph`, `Outcome`, `CheckpointState`); `runLoop()` refactored to return `LoopResult`, accept `AbortSignal`, throw instead of `process.exit` |
| 2 — DOT Parser | 3-4 | Hand-rolled DOT parser (`parseDot`); graph validator (`validateGraph`, `validateOrRaise`); `resolveHandlerType` |
| 3 — Conditions + Checkpoint | 5-6 | Edge condition expression evaluator; `saveCheckpoint` / `loadCheckpoint` |
| 4 — Interviewer + Transforms | 7-8 | Interviewer interface + four implementations (auto-approve, queue, callback, console); variable expansion (`$goal`/`$project`) and preamble synthesis transforms |
| 5 — Handlers | 9-10b | Handler registry; codergen, tool, wait-human, conditional, start-exit, parallel, fan-in, manager-loop, ralph-implement, ralph-meditate, ralph-scenarios handlers |
| 6 — Execution Engine | 11 | Pipeline traversal, edge selection, retry logic, goal gate enforcement, checkpoint integration |
| 7 — Pipeline Command | 12-13 | `ralph pipeline run/validate` CLI commands; final wiring and DoD verification |

---

## Post-Implementation Fixes

1. **Goal gate enforcement** was missing from `engine.ts` — now implemented with tests (4 new engine tests).
2. **Model stylesheet parser bug:** multi-line quoted graph attribute values were not collapsed before line splitting — fixed.
3. **Model stylesheet test coverage** expanded: shape/id/universal selectors + specificity ordering.
4. **CodergenHandler** `llmModel` passthrough tested.
5. **Spec editorial fixes:**
   - NEW-1: added `allow_partial` v1 note.
   - NEW-2: removed stray `loop_restart` from node attrs.

---

## File Map Summary

| File | Status | Responsibility |
|------|--------|----------------|
| `src/attractor/types.ts` | NEW | Shared types: Node, Edge, Graph, Outcome, CheckpointState |
| `src/attractor/core/graph.ts` | NEW | DOT parser (`parseDot`), validator (`validateGraph`, `validateOrRaise`), `resolveHandlerType` |
| `src/attractor/core/engine.ts` | NEW | Pipeline traversal, edge selection, retry, goal gate, checkpoint |
| `src/attractor/core/conditions.ts` | NEW | Edge condition expression evaluator |
| `src/attractor/checkpoint.ts` | NEW | `saveCheckpoint` / `loadCheckpoint` |
| `src/attractor/handlers/registry.ts` | NEW | Handler interface + lookup map |
| `src/attractor/handlers/codergen.ts` | NEW | Box node handler — wraps `runLoop()` |
| `src/attractor/handlers/tool.ts` | NEW | Parallelogram node — shell command execution |
| `src/attractor/handlers/wait-human.ts` | NEW | Hexagon node — blocks for interviewer input |
| `src/attractor/handlers/conditional.ts` | NEW | Diamond node — no-op pass-through |
| `src/attractor/handlers/start-exit.ts` | NEW | Mdiamond/Msquare no-op handlers |
| `src/attractor/handlers/parallel.ts` | NEW | `ParallelHandler` (fan-out) + `FanInHandler` (tripleoctagon) |
| `src/attractor/handlers/manager-loop.ts` | NEW | `ManagerLoopHandler` — polling supervisor loop (house shape) |
| `src/attractor/handlers/ralph-implement.ts` | NEW | `ralph.implement` alias for codergen |
| `src/attractor/handlers/ralph-meditate.ts` | NEW | `ralph.meditate` subprocess handler |
| `src/attractor/handlers/ralph-scenarios.ts` | NEW | `ralph.run-scenarios` subprocess handler |
| `src/attractor/interviewer/index.ts` | NEW | Interviewer interface + types |
| `src/attractor/interviewer/auto-approve.ts` | NEW | AutoApproveInterviewer |
| `src/attractor/interviewer/queue.ts` | NEW | QueueInterviewer (for tests) |
| `src/attractor/interviewer/callback.ts` | NEW | CallbackInterviewer |
| `src/attractor/interviewer/console.ts` | NEW | ConsoleInterviewer (stdin readline) |
| `src/attractor/transforms/variable-expansion.ts` | NEW | `$goal`/`$project` substitution |
| `src/attractor/transforms/preamble.ts` | NEW | Context carryover preamble synthesis |
| `src/cli/commands/pipeline.ts` | NEW | `ralph pipeline run/validate` |
| `src/cli/lib/loop.ts` | MODIFIED | Returns `LoopResult`, accepts `AbortSignal`, throws instead of `process.exit` |
| `src/cli/commands/implement.ts` | MODIFIED | Wraps `runLoop` in try/catch + own `AbortController` |
| `src/cli/program.ts` | MODIFIED | Registers `pipeline` subcommand |
