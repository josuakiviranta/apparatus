---
date: 2026-04-13
status: archived
description: The pipeline engine's extension surface is perfectly designed but entirely sealed — NodeHandler is the right interface, buildHandlerMap is the right entry point, but package.json exports nothing and EngineOptions has no extraHandlers slot, leaving consumer projects stranded at the tool node ceiling.
archived_at: 2026-04-27
reason: Speculative library-export scope, no validated consumer needing custom NodeHandler today
---

## Core Idea

ralph's pipeline engine is a library that doesn't know it's a library. `runPipeline()` in `src/attractor/core/engine.ts` is a clean, well-designed function. `NodeHandler` in `src/attractor/handlers/registry.ts` is a minimal, correct interface — implement `execute(node, ctx, meta)`, return an `Outcome`. The architecture is ready for extension. But `package.json` declares zero `exports` — nothing is importable from `ralph-cli` as a module — and `buildHandlerMap()` is a closed private function that hardcodes exactly 13 node types with no external registration point. A consumer project cannot add a custom node type, cannot import the engine programmatically, and cannot influence handler selection at runtime. Every workflow that doesn't fit the 13-type vocabulary must shoehorn into `tool` (one synchronous shell command) or `agent` (a full Claude session). The interface layer is correct. The registration layer is missing.

## Why It Matters

The three prior illuminations (T2300, T0000, T0100) address the authoring stack: you can't find bundled pipelines, the create session is context-blind, and there are no named patterns to choose from. This gap is orthogonal — it's a runtime problem, not an authoring problem. Even if a consumer project finds a bundled pipeline, runs `ralph pipeline create` with full context awareness, and picks the right pattern — if their workflow needs a node that deploys to their staging environment, runs their custom linter with structured JSON output, or integrates with their internal API, they hit the `tool` node ceiling.

The `tool` node in `src/attractor/handlers/tool.ts` runs a single `spawnSync` shell command and writes its stdout to `tool.output` as a string. It is synchronous, has no structured output contract, and provides no way to write typed `contextUpdates` beyond a raw string. Consumer projects building serious automation — the ones most likely to invest in ralph as a wrapper — exhaust this ceiling quickly.

The gene transfusion lens makes the opportunity legible: `NodeHandler` is the abstraction worth transfusing into consumer projects. It is already the right shape. The first transfusion — exposing it as a public type — costs almost nothing and unlocks every downstream consumer. The semport framing applies too: ralph's engine accumulates design judgment (retry logic, goal gates, context passing, checkpoint persistence, `UndefinedVariableError` handling) that consumer projects want access to as building blocks, not only as a sealed CLI invocation.

The fix does not require redesigning anything. `EngineOptions` already has the right structure. `buildHandlerMap` already takes `opts` as its only argument. Two changes close the gap: add `extraHandlers?: Map<string, NodeHandler>` to `EngineOptions` and merge it into the map. One convention bridges it to the CLI: a `ralph.config.js` file in the project root (like `vite.config.js`) that `ralph pipeline run` imports dynamically if present, passing its `handlers` export to the engine. Consumer projects stay in CLI mode — no programmatic invocation required — but they gain first-class node registration.

## Revised Implementation Steps

1. **Add `extraHandlers?: Map<string, NodeHandler>` to `EngineOptions`** in `src/attractor/core/engine.ts`. Inside `buildHandlerMap(opts)`, after building the default map, iterate `opts.extraHandlers` and merge. Last-write wins — consumer handlers can override built-ins if needed.

2. **Export public types from a `ralph-cli/engine` subpath.** Add an `exports` field to `package.json`:
   ```json
   "exports": {
     ".": "./dist/cli/index.js",
     "./engine": "./dist/attractor/engine-api.js"
   }
   ```
   Create `src/attractor/engine-api.ts` that re-exports `NodeHandler`, `HandlerExecutionContext`, `PipelineContext`, `Outcome`, and `runPipeline`. This is the contract surface — keep it narrow.

3. **Define the `ralph.config.js` convention.** In `src/cli/commands/pipeline.ts`, before calling `runPipeline`, check for `<project>/ralph.config.js`. If present, `await import()` it and extract a `handlers` export typed as `Map<string, NodeHandler>`. Pass it as `extraHandlers` to the engine. If absent, proceed with defaults. This is the only CLI-side change needed — no new command, no new flag.

4. **Document the convention in `specs/` or `README.md`.** The contract is: create `ralph.config.js` at the project root, export a `handlers` map keyed by node type string, implement each value as a `NodeHandler`. A minimal example — a `deploy` node type that runs a project-specific script and returns structured context — should be the first example shown.

5. **Update `PROMPT_pipeline_create.md`** to mention `ralph.config.js` custom handlers as a node type option. The authoring agent should be able to say "if your project defines a `deploy` handler in `ralph.config.js`, you can use `shape=box, type=deploy` as a node type." This closes the loop between authoring and runtime: the vocabulary the agent knows about matches the vocabulary the engine can execute.
