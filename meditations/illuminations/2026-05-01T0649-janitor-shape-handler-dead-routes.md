---
date: 2026-05-01
description: graph.ts SHAPE_TO_TYPE and engine.ts buildHandlerMap retain four legacy shape-to-handler routes (box→codergen, circle→ralph.implement, octagon→ralph.meditate, diamond→conditional) that no real pipeline uses — confirmed by grepping all .dot files.
---

## Findings

1. **What:** Four shape-to-handler routes in `graph.ts` and `engine.ts` have zero real consumers and persist only as dead registration weight.

   **Evidence:**
   - `src/attractor/core/graph.ts:42-45` — `SHAPE_TO_TYPE` maps four shapes to legacy handler types:
     ```
     box: "codergen"
     circle: "ralph.implement"
     octagon: "ralph.meditate"
     diamond: "conditional"
     ```
   - `src/attractor/core/graph.ts:29-31` — `KNOWN_HANDLER_TYPES` includes all four (`"codergen"`, `"ralph.implement"`, `"ralph.meditate"`, `"conditional"`) so the validator silently accepts nodes with these shapes.
   - `src/attractor/core/engine.ts:52,56` — `buildHandlerMap` still registers `codergen` and `ralph.implement` (both map to `agentHandler`):
     ```ts
     m.set("codergen", agentHandler);
     m.set("ralph.implement", agentHandler);
     ```
   - Grepping all `.dot` files in the repo for `shape="box"`, `shape="circle"`, `shape="octagon"`, `shape="diamond"` yields **zero matches** outside test fixtures. The single test hit (`graph.test.ts:1049`) uses `shape="box"` on an orphan node — it is not exercising the codergen handler path, only the orphan-detection rule.
   - `docs/specs/pipeline.md:112` still documents `codergen` and `ralph.implement` as valid node types, perpetuating the illusion that authors can use them.

   **Why it matters (KISS lens):** A reader of `engine.ts` sees 13 handler registrations and must reverse-engineer which ones any pipeline can actually trigger. `codergen` and `ralph.implement` are silently identical to `agent` (same `AgentHandler` instance). `ralph.meditate` and `conditional` each name a handler whose shape trigger (`octagon`, `diamond`) exists nowhere in production. Every new pipeline author consulting the handler map or the spec inherits four phantom choices that produce surprise when used, or confusion when they notice no bundled pipeline uses them.

   **Suggested action:**
   - Remove `SHAPE_TO_TYPE` entries for `box`, `circle`, `octagon`, `diamond`.
   - Remove `"codergen"` and `"ralph.implement"` from `KNOWN_HANDLER_TYPES` and from `buildHandlerMap`.
   - Assess whether `ConditionalHandler` and `RalphMeditateHandler` have surviving call sites beyond shape-dispatch (if not, delete them too).
   - Update `docs/specs/pipeline.md:112` to remove the `codergen` / `ralph.implement` rows.

## Reading thread

- `2026-05-01T0423-janitor-parallel-handler-yagni.md` — same genus (dead handler registrations), different species: covers `parallel` and `parallel.fan_in` which no `.dot` file uses. This finding covers the four shape-routed legacy aliases, which are a separate dead branch in `SHAPE_TO_TYPE` + `KNOWN_HANDLER_TYPES` + `buildHandlerMap`.
- `2026-05-01T0255-bundled-pipeline-exemplars-disagree.md` — notes exemplar anatomy drift; the `codergen`/`ralph.implement` doc entries in `pipeline.md:112` compound that drift by offering two more authoring options no bundled pipeline demonstrates.
