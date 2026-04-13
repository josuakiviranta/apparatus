# Undefined Variable Backpressure Guard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pipeline variable expansion fail loudly on undefined variables, add static validation to catch coverage gaps before execution, and scope chat notes per-run to prevent cross-illumination contamination.

**Architecture:** Three layers — (1) `expandVariables` throws `UndefinedVariableError` instead of silent passthrough, (2) a `variable_coverage` rule in `validateGraph()` warns about unreachable producers, (3) the engine catches pipeline-fatal errors, tears down agents, and emits a structured error trace. Chat notes move from a global path to a per-run scoped path.

**Tech Stack:** TypeScript, vitest

**Design Spec:** `docs/superpowers/specs/2026-04-13-undefined-variable-backpressure-guard-design.md`

---

## Chunk 1: Runtime guard — `expandVariables` throws on undefined variables ✅ DONE

Completed: `expandVariables` now throws `UndefinedVariableError` on undefined variables with optional `defaults` parameter support. `variableExpansionTransform` catches the error gracefully (pre-expansion pass). All 45 transform tests pass.

**Note:** Runtime callers (tool.ts, agent-handler.ts, wait-human.ts, store.ts) will throw unhandled `UndefinedVariableError` until Chunk 3 adds the engine-level catch boundary. This is the intended intermediate state.

---

## Chunk 2: Static validation — `variable_coverage` rule in `validateGraph()` ✅ DONE

Completed: `validateGraph()` now includes a `variable_coverage` rule that warns when a `$variable` used in a node's prompt/toolCommand may be undefined because all producer nodes can be bypassed via conditional routing. Uses BFS reachability algorithm (remove all producers, check if consumer still reachable from start).

**Producer detection:** handler type conventions (tool→tool.output, store→store.path, wait.human→chat.output), interactive nodes→chat.output, explicit `produces` attribute on nodes. Consumer `default_<var>` attributes suppress warnings.

**Also completed:** ToolHandler now calls `expandVariables` on `toolCommand` at runtime.

8 new test cases, all 48 graph tests pass. Tagged v0.1.14.

---

## Chunk 3: Graceful shutdown + structured error trace ✅ DONE

Completed: Engine catches `UndefinedVariableError` thrown by any handler during `handler.execute()`. On catch: immediately returns `{ status: "fail" }` with structured `failureReason` containing variable name, node name, execution path, and full variable context dump. Fires `onNodeEnd` with fail status for TUI updates. Non-variable errors re-thrown. 3 new tests (24 total engine tests), all pass.

**Remaining spec items deferred to future work:**
- Producer node detection (requires graph analysis from variable_coverage rule)
- Skipped node analysis (requires comparing actual vs possible paths)
- Trace file output to `meditations/.triage/<run-id>/error-trace.json`
- Agent teardown is a no-op in the current sequential engine (no concurrent in-flight agents)

---

## Chunk 4: Chat notes per-run scoping ✅ DONE

Completed: Engine generates `run_id` (UUID via `randomUUID()`) at pipeline start, adds to context. Dot file `illumination-to-plan.dot` now uses `$run_id` in chat-notes paths (`meditations/.triage/$run_id/chat-notes.md`). Each run gets a unique directory — no cross-contamination. 2 new tests, 26 total engine tests pass.

**Note:** Per-run directory cleanup deferred — unique paths prevent collision without cleanup. Engine shouldn't know about domain-specific paths.

---

## Chunk 5: Pipeline dot file defaults for optional variables ✅ DONE

Completed: Added `extractDefaults(node)` utility that extracts camelCase `default*` node attributes into a flat `Record<string, string>`. Wired into AgentHandler and ToolHandler as 3rd arg to `expandVariables()`. Added `default_refinements` to `design_writer` in `illumination-to-plan.dot`. The Approve-without-Chat path now gets "No interactive refinements were requested." instead of throwing. 5 new extractDefaults tests, 713 total tests pass.

---

## All Chunks Complete

Smoke tests (manual validation) remain for end-to-end verification when running the full pipeline.
