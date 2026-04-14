---
date: 2026-04-14
status: open
description: The pipeline engine already has every ingredient for a mock routing harness — NodeHandler, runPipeline, completedNodes — but no extraHandlers slot and no testing export, so consumer pipeline authors must pay a full API call to verify that a conditional edge routes correctly.
---

## Core Idea

After `ralph pipeline create` produces a `.dot` file, the only way to verify that conditional routing is wired correctly is to run the full pipeline and observe the TUI. Each iteration of "did I wire this edge right?" costs a real Claude API call, real seconds, and real attention. The T-series illuminations (T2300–T0700) address distribution, authoring, patterns, extensibility, manifests, and org presets — they collectively fix the path from zero to a valid `.dot` file. None of them address what happens the moment you try to *debug* or *iterate* on one. The engine already contains every primitive needed for a mock harness: `NodeHandler` is the right interface, `runPipeline` accepts arbitrary options, and `PipelineResult.completedNodes` already records which nodes were visited. What's missing is one slot in `EngineOptions` and one `ralph-cli/testing` export.

## Why It Matters

`buildHandlerMap` in `src/attractor/core/engine.ts` is a closed private function. `EngineOptions` has no `extraHandlers` field. A consumer pipeline author cannot inject a mock handler that returns a controlled `Outcome` without forking the engine. This means the conditional routing logic that is hardest to get right — the `[label="fail"]` edges, the `goal_gate` enforcement, the `loop_restart` paths — is also the logic that takes the most API calls to verify. A 4-node pipeline with two conditional branches might require 6–8 full runs to confirm that every path routes as designed. For consumer projects building serious automation (the users most invested in getting this right), that cost compounds across every iteration.

The mechanism for a fix is already visible in the engine. `buildHandlerMap` returns a `Map<string, NodeHandler>`. If `EngineOptions` accepted `extraHandlers?: Map<string, NodeHandler>`, those entries would override defaults when merged. A test could inject:

```ts
extraHandlers: new Map([
  ['run-tests', { execute: async () => ({ status: 'fail', failureReason: 'suite red' }) }],
  ['fix-loop',  { execute: async () => ({ status: 'success' }) }],
])
```

Then call `runPipeline(graph, opts)` and assert that `result.completedNodes` contains `'fix-loop'` and not `'exit-success'`. No Claude. No shell. Milliseconds. The gene transfusion lens makes the value concrete: this is the validation step that transforms "I think my conditional is wired right" into a confirmed, repeatable test. Without it, every pipeline the T-series makes easier to author still takes the same painful API-billed iteration loop to verify.

The `ralph-cli/testing` subpath export is the public surface. It needs to re-export three things: `runPipeline`, `NodeHandler` (the mock target type), and `parseGraph` (so tests can load a `.dot` file without invoking the full CLI). These are already implemented. The testing story is one `exports` entry in `package.json`, a one-line merge in `buildHandlerMap`, and an example test in `docs/`.

The dark factory lens adds urgency. Unattended pipelines running against consumer projects at scale cannot be trusted unless their routing logic is tested before deployment. A pipeline that silently routes to the wrong branch on a `fail` outcome — because an edge label was `"Failed"` not `"fail"` — is worse than a broken pipeline: it appears to complete while taking the wrong path. A mock harness makes this class of bug catchable in CI before the pipeline ever runs against production state.

## Revised Implementation Steps

1. **Add `extraHandlers?: Map<string, NodeHandler>` to `EngineOptions`** in `src/attractor/core/engine.ts`. In `buildHandlerMap(opts)`, after building the default 13-entry map, iterate `opts.extraHandlers` and call `m.set(key, handler)` for each entry. Last-write wins — consumer mock handlers override built-ins. This is a 3-line change with zero architectural consequence.

2. **Create `src/attractor/engine-api.ts`** that re-exports `runPipeline`, `NodeHandler`, `HandlerExecutionContext`, `PipelineContext`, `Outcome`, and `parseGraph` from `src/attractor/core/graph.ts`. Keep the surface narrow — these six exports are the test contract. Do not re-export `buildHandlerMap` or internal handler classes.

3. **Add a `ralph-cli/testing` subpath to `package.json` exports**:
   ```json
   "exports": {
     ".": "./dist/cli/index.js",
     "./testing": "./dist/attractor/engine-api.js"
   }
   ```
   Add the corresponding `tsup` entry so `src/attractor/engine-api.ts` compiles to `dist/attractor/engine-api.js`.

4. **Write `docs/pipeline-testing.md`** with a minimal working example: load a `.dot` file with `parseGraph`, construct `EngineOptions` with mock handlers and a temp `logsRoot`, call `runPipeline`, assert on `completedNodes`. Show one test for the happy path and one for the failure-routing path. This document is the gene transfusion artifact — the exemplar consumer authors read before writing their own routing tests.

5. **Add one routing test to ralph-cli's own smoke test suite** using the new `extraHandlers` slot, against `pipelines/smoke/conditional.dot`. This validates the mechanism works, demonstrates the pattern internally, and ensures the interface doesn't regress. It also gives `pipeline create` sessions a local exemplar to reference when the authoring agent is asked "how do I test this pipeline?"
