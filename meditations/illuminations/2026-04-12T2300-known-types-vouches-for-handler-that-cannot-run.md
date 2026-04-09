---
date: 2026-04-09
description: KNOWN_TYPES in graph.ts includes stack.manager_loop so validation passes, but buildHandlerMap in engine.ts has no entry for it — the validator vouches for a type the runtime refuses to execute, and ManagerLoopHandler cannot be generically wired without architectural work that hasn't happened.
---

## Core Idea

`KNOWN_TYPES` in `src/attractor/core/graph.ts` includes `"stack.manager_loop"`. Nodes with `type=stack.manager_loop` or the `house` shape pass `validateGraph` without any warning. But `buildHandlerMap` in `src/attractor/core/engine.ts` does not register a handler for `"stack.manager_loop"` — the `ManagerLoopHandler` class exists in `src/attractor/handlers/manager-loop.ts` and is fully implemented, but it requires a `pollChild: () => Promise<ChildStatus>` function at construction time. `EngineOptions` has no such field. The two registries have diverged: `KNOWN_TYPES` says "this type is supported," `buildHandlerMap` says it isn't. At runtime, `handlers.get("stack.manager_loop")` returns `undefined` and the pipeline fails with `No handler for type "stack.manager_loop"`.

## Why It Matters

`KNOWN_TYPES` and `buildHandlerMap` are two independent registries for the same concept: which node types does this engine support? There is no enforced relationship between them. A developer can add a type to `KNOWN_TYPES` (one line in `graph.ts`) without wiring it into `buildHandlerMap` (a different file, a different operation, and in this case a non-trivial architectural decision). The gap is invisible at build time and invisible at validation time. It surfaces only when a user runs a pipeline with that node type.

`ManagerLoopHandler` is architecturally different from every other handler: it requires a `pollChild` callback to supervise a child pipeline. The generic factory pattern in `buildHandlerMap(opts: EngineOptions)` cannot supply that callback without knowing which child to supervise. This isn't a missing line — it's a missing integration contract. The handler is done; the engine doesn't know how to instantiate it.

This matters now for two reasons:

1. **The 1500 illumination recommends updating `PROMPT_pipeline_create.md` to correctly document all supported node types.** If `stack.manager_loop` appears in that documentation (because it's in `KNOWN_TYPES` and has a DOT shape alias), Claude will author pipelines that use `house`-shaped nodes. Users will run `ralph pipeline validate` — no warnings. Then `ralph pipeline run` crashes with a cryptic internal error.

2. **The `the-agentic-loop-is-a-graph` lens names composability as a first-class property**: "graphs can be nested, sequenced, or wired together." `ManagerLoopHandler` exists precisely to enable parent-child pipeline composition. Its presence in `KNOWN_TYPES` signals that composability is available when it isn't. The gap is not a marginal corner case — it's the feature that makes pipeline orchestration a system rather than a single flow.

## Revised Implementation Steps

1. **Remove `stack.manager_loop` from `KNOWN_TYPES` until the handler is wired.** A missing-type warning on a node the engine can't run is less harmful than no warning at all. This is a one-line change in `graph.ts`. Replace with a comment: `// stack.manager_loop: handler exists but not registered (requires pollChild wiring)`.

2. **Add a `handler_exists` validation rule.** `validateGraph` currently checks `KNOWN_TYPES` at the end to emit `type_known` warnings. Extend this: for each node whose resolved handler type is not in a hardcoded set of always-registered types (`start`, `exit`, `codergen`, `conditional`, etc.), emit a `severity: "error"` diagnostic: `Handler type "X" is not registered in the engine. This pipeline will fail at runtime.` This closes the gap structurally, not just by keeping the two lists in sync manually.

3. **Define the `pollChild` integration contract.** Add `getChildStatus?: (logsRoot: string) => Promise<{ status: "running" | "success" | "fail" }>` to `EngineOptions`. In `buildHandlerMap`, conditionally instantiate `ManagerLoopHandler`:
   ```ts
   if (opts.getChildStatus) {
     m.set("stack.manager_loop", new ManagerLoopHandler(
       () => opts.getChildStatus!(opts.logsRoot)
     ));
   }
   ```
   Without `getChildStatus`, `stack.manager_loop` nodes fail with a diagnostic, not a crash.

4. **Add a test for the unregistered type path.** In `engine.test.ts`, build a minimal graph with a `stack.manager_loop` node and call `runPipeline` without `getChildStatus`. Assert `result.status === "fail"` and `result.failureReason` contains `"No handler"`. This test codifies the current (broken) behavior and will pass once the handler is either registered or produces a clear failure mode.

5. **Exclude `stack.manager_loop` from any prompt documentation until step 3 is complete.** The 1500 illumination's fix to `PROMPT_pipeline_create.md` should not mention `stack.manager_loop`, `house` shape, or parent-child composition. Document what works. The pipeline graph is observable precisely because it names what it does — the prompt should name what the engine actually supports.
