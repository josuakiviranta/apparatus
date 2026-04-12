---
date: 2026-04-12
description: Three compounding refactoring opportunities: the untyped meta bag in NodeHandler.execute(), the dual handler registries, and duplicated arg-building in Agent — all stem from growth-by-addition rather than consolidation.
---

## Core Idea

The codebase has three overlapping refactoring opportunities that compound each other. First: `NodeHandler.execute()` takes `meta: Record<string, unknown>` — an untyped grab-bag carrying `logsRoot`, `cwd`, `signal`, `onStdout`, `onInteractiveRequest`, `completedNodes`, `nodeRetries`, `dotDir`, and `outgoingLabels` as string-keyed values. TypeScript cannot verify any of these keys, and misspelling one silently returns `undefined`. Second: two handler registries coexist — `registry.ts` exports `registerHandler`/`lookupHandler`/`clearHandlers` but `engine.ts` builds its own local `buildHandlerMap()` and ignores the module-level registry entirely; the same `AgentHandler` instance is registered under three aliases (`codergen`, `ralph.implement`, `agent`) with no canonical name. Third: `Agent.buildArgs()` and `Agent.buildInteractiveArgs()` open identically — model flag, permission mode flag, tools flags — before diverging; the duplication means a new flag (e.g. `--reasoning-effort`) must be added in two places to take effect in both modes.

## Why It Matters

All three problems share the same root: complexity was added by appending to existing structures rather than formalizing interfaces. The `meta` bag started small and grew as each new handler needed more context — now `agent-handler.ts` casts `meta["onInteractiveRequest"]` as a full function type, which is indistinguishable from a bug until runtime. The dual registries mean `registry.ts` (`src/attractor/handlers/registry.ts`) is dead production code — the exported `registerHandler` and `lookupHandler` functions are never called by `runPipeline` — yet they imply the intent to have a dynamic registry, creating false architectural signal. The `buildArgs` duplication in `src/cli/lib/agent.ts` (lines ~90–115 and ~240–265 respectively) is the cheapest to fix but sets the pattern: every new CLI flag needs a two-place edit, and the test surface for `buildArgs` covers only one path.

These three are compounding because fixing the `meta` bag requires defining a typed `HandlerExecutionContext` interface, which naturally surfaces that `registry.ts`'s `NodeHandler` interface should be updated too, which clarifies that the dual registry pattern should be resolved before adding more handler types.

## Revised Implementation Steps

1. **Define `HandlerExecutionContext`** in `src/attractor/handlers/registry.ts`. Replace `meta: Record<string, unknown>` with a typed struct: `{ logsRoot: string; cwd: string; dotDir: string; signal?: AbortSignal; outgoingLabels: string[]; completedNodes: string[]; nodeRetries: Record<string, number>; onStdout?: (s: NodeJS.ReadableStream) => Promise<void>; onInteractiveRequest?: OnInteractiveRequest }`. Update the `NodeHandler` interface and all implementing classes.

2. **Resolve the dual registry** by deleting the module-level `handlers` Map and its three exports from `registry.ts`, or by making `engine.ts`'s `buildHandlerMap()` use it. The simplest resolution: keep `buildHandlerMap()` in `engine.ts` as the single source of truth, and repurpose `registry.ts` to contain only the `NodeHandler` interface and `HandlerExecutionContext` type. Remove the dead `registerHandler`/`lookupHandler`/`clearHandlers` exports.

3. **Extract `buildCommonArgs()`** in `src/cli/lib/agent.ts` — pull out model, permission mode, and tools flag construction into a shared private method called by both `buildArgs()` and `buildInteractiveArgs()`. This is a 20-line change that prevents future flag-addition bugs.

4. **Extract `parseStructuredOutput(rawText: string)`** from `agent-handler.ts` (currently ~80 inline lines in `execute()`). The same JSON-array-vs-NDJSON detection logic also appears in `agent.ts`'s JSON schema branch; a shared utility in `src/cli/lib/` would eliminate the duplication and make the output-parsing behavior testable in isolation.

5. **After steps 1–2**, run `grep -r 'meta\[' src/attractor/handlers/` to verify no untyped key access remains. Any surviving cast (`as string`, `as AbortSignal`, etc.) is a sign that the `HandlerExecutionContext` type is still incomplete.
