---
date: 2026-05-05
description: conditional.ts (8 lines) and parallel.ts (23 lines) implement the NodeHandler interface but do near-zero work — the real branching/fan-in lives in engine.ts edge selection. Polymorphism is shallow for control-flow node types.
---

## Files

- `src/attractor/handlers/conditional.ts` (8 lines)
- `src/attractor/handlers/parallel.ts` (23 lines)
- `src/attractor/handlers/registry.ts` — `NodeHandler` interface + handler map
- `src/attractor/core/engine.ts` (355 lines) — owns edge selection, branch fan-out, fan-in coordination

## Problem

The `NodeHandler` seam exists for node types that do real per-variant work: `agent` (Claude subprocess + stream), `tool` (shell command + capture), `wait-human` (interactive gate), `store` (context-key write), `manager-loop` / `start-exit`. For these the deletion test passes — removing a handler concentrates real complexity that would otherwise reappear in engine.

`conditional` and `parallel` are different. They are control-flow primitives, not node variants:

- `conditional` returns success immediately; the actual branch decision lives in engine's edge-selection code based on `condition=` attributes.
- `parallel` is a named tuple encoder/decoder for fan-in — the orchestration of parallel branch outcomes lives in engine.

An 8-line handler that does nothing real is **indirection, not leverage**. Polymorphism here is shallow: the seam exists but the variant work is elsewhere.

## Solution

- Pull `conditional` orchestration fully into engine's edge-selection code; remove `ConditionalHandler` from the registry.
- Fold `parallel` fan-out / fan-in into engine's branch coordinator; remove `ParallelHandler` from the registry.
- Keep `NodeHandler` for node types that do real work. Do not enlarge engine without need — pull only the dispatch back, leave the seam meaningful.

When a future node type adds genuinely novel control flow (e.g. recurring loop, fork-join with timeout), revisit whether it deserves a handler or belongs in engine.

## Benefits

- **Locality:** all branching/parallelism control flow lives in `engine.ts`. Bugs in branch ordering, fan-in races, or edge-condition evaluation surface where they originate, not split between engine + a near-empty handler.
- **Test surface:** removes test files that exercise no real behavior; control-flow tests live with engine where the variant logic actually lives.
- **Seam clarity:** `NodeHandler` becomes a meaningful interface again — every implementer encapsulates real per-type complexity. The deletion test passes for the survivors.
- **Anti-bloat-handler:** prevents the "every node type gets a handler file" reflex from continuing to add empty wrappers for future control-flow primitives.
