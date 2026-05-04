---
date: 2026-05-01
description: ParallelHandler and FanInHandler are implemented, tested, and registered in the engine but no pipeline dot file uses type=parallel or type=parallel.fan_in — pure speculative generality that inflates the type system with `partial_success`.
---

## Findings

1. **What:** `ParallelHandler` and `FanInHandler` are fully implemented, covered by 7 tests, and registered in the engine handler map — but no pipeline `.dot` file in the codebase uses `type=parallel` or `type=parallel.fan_in`.

   **Evidence:**
   - `src/attractor/handlers/parallel.ts:4` — `export class ParallelHandler implements NodeHandler { … }`
   - `src/attractor/handlers/parallel.ts:14` — `export class FanInHandler implements NodeHandler { … }`
   - `src/attractor/core/engine.ts:58-59` — `m.set("parallel", new ParallelHandler()); m.set("parallel.fan_in", new FanInHandler());`
   - `src/attractor/tests/handlers.test.ts:117-183` — 7 describe/it blocks exercising both classes
   - `src/attractor/types.ts:1` — `"partial_success"` added to `OutcomeStatus` union solely to satisfy `FanInHandler`'s return value
   - **Zero matches** for `type=parallel` or `type=parallel.fan_in` across all `.dot` files in `pipelines/` and `src/`

   **Why it matters (KISS lens):** A reader of the codebase discovers a parallel execution subsystem and must work out whether it is an active feature or a prototype. The `partial_success` status in the `OutcomeStatus` union implies the engine has broader outcome semantics than it actually does — every handler that does not account for `partial_success` is silently correct only because nothing ever returns it. The 7 handler tests give false confidence that the feature is load-bearing.

   **Suggested action:** Delete `src/attractor/handlers/parallel.ts` and the 7 corresponding tests in `handlers.test.ts`. Remove lines 58-59 from `engine.ts`. Remove `"partial_success"` from the `OutcomeStatus` union in `types.ts`. If parallel execution is revisited, it should be designed against a real pipeline need.

## Reading thread

- `2026-05-01T0120-janitor-graph-validator-bloat.md` — covers graph.ts bulk/duplication; parallel.ts is a separate, smaller dead module not mentioned there.
- `2026-05-01T0212-janitor-dead-two-phase-fn.md` — also a dead-export pattern (runTwoPhaseClaudeSession); parallel handler is the same class of finding in the attractor layer.
- `2026-05-01T0255-janitor-dead-scripts.md` — dead scripts; parallel handler is dead runtime code, not scripts.
