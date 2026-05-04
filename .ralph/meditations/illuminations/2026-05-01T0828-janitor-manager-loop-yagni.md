---
date: 2026-05-01
description: ManagerLoopHandler is fully implemented and tested but the graph validator explicitly marks stack.manager_loop as unregistered — the class exists, four tests cover it, yet no pipeline can ever invoke it.
---

## Findings

1. **What:** `ManagerLoopHandler` is a fully implemented handler class with its own interface and config type, but the graph validator explicitly lists `stack.manager_loop` in `UNIMPLEMENTED_TYPES` and emits a hard `type_unsupported` error for any pipeline that references it — so the code exists, is tested, and can never run.

   **Evidence:**
   - `src/attractor/handlers/manager-loop.ts:16`: `export class ManagerLoopHandler implements NodeHandler` — 45-line class with `ManagerLoopConfig` (pollIntervalMs, maxCycles), a poll loop, and success/fail/timeout outcomes
   - `src/attractor/core/graph.ts:38`: `"stack.manager_loop",              // no handler registered` inside `UNIMPLEMENTED_TYPES`
   - `src/attractor/core/graph.ts:32`: also appears in `KNOWN_TYPES` — meaning the type is syntactically valid but immediately rejected at validation
   - `src/attractor/core/graph.ts:44`: `house: "stack.manager_loop"` in `SHAPE_TO_TYPE` — the `house` DOT shape maps to the type, but any node using it triggers `type_unsupported` error
   - `src/attractor/tests/handlers.test.ts:189-222`: 4 test cases (`ManagerLoopHandler` describe block) covering success, fail, exceed-max-cycles, immediate-success — all testing infrastructure the engine cannot invoke
   - Zero `.dot` pipeline files (bundled or smoke) use `house` shape or `type=stack.manager_loop`

   **Why it matters (KISS lens):** A reader sees a named handler class, an interface, config options, and four passing tests — a false impression that sub-pipeline management is operational. The validator's `UNIMPLEMENTED_TYPES` comment corrects this, but only if the reader thinks to cross-reference graph.ts. The conceptual surface area is: one class file, one interface, one config type, 45 handler lines, 4 test cases, 3 graph.ts entries (`KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE`) — all load-bearing zero actual functionality.

   **Suggested action:** Delete `src/attractor/handlers/manager-loop.ts`, remove the `ManagerLoopHandler` describe block from `handlers.test.ts:189-222`, and remove the three `stack.manager_loop` entries from `graph.ts` (`KNOWN_TYPES` line 32, `UNIMPLEMENTED_TYPES` line 38, `SHAPE_TO_TYPE` line 44). When sub-pipeline composition is revisited, start from the ADR decision rather than this abandoned prototype.

## Reading thread

- `2026-05-01T0423-janitor-parallel-handler-yagni.md` — parallel/fan_in handlers are similarly unused by pipelines; key difference: those ARE registered in the engine (buildHandlerMap). `ManagerLoopHandler` is not registered anywhere — a harder dead-end.
- `2026-05-01T0820-pipeline-spec-drift-poisons-agents.md` — flags "manager_loop row that disagrees with its own handler file" as a spec-drift symptom; this finding is about the dead code itself, not the documentation gap.
