# Handler Context, Registry Cleanup, and Deduplication Design

**Date:** 2026-04-14
**Status:** Approved
**Feature:** Four compounding refactors — typed handler context, registry consolidation, shared arg builder, shared output parser

## Problem

The codebase has four overlapping issues that stem from growth-by-addition rather than consolidation:

1. **Untyped `meta` bag** — `NodeHandler.execute()` takes `meta: Record<string, unknown>`, forcing unsafe casts like `meta["onInteractiveRequest"] as OnInteractiveRequest` across handler implementations. A misspelled key silently returns `undefined`.
2. **Dead dual registry** — `registry.ts` exports `registerHandler`/`lookupHandler`/`clearHandlers` but zero production code calls them; `engine.ts` builds its own handler map via `buildHandlerMap()`, making the module-level registry dead code that emits false architectural signal.
3. **Duplicated arg construction** — `buildArgs()` and `buildInteractiveArgs()` in `src/cli/lib/agent.ts` open identically (model flag, permission mode, tools flags, MCP config) before diverging. Every new CLI flag requires a two-place edit.
4. **Duplicated output parsing** — JSON-array-vs-NDJSON detection logic appears in both `agent-handler.ts` (~76 lines) and `agent.ts` (~85 lines) with no shared utility.

These compound: fixing the `meta` bag requires defining a typed interface, which naturally surfaces that `registry.ts`'s `NodeHandler` interface should be updated, which clarifies that the dual registry should be resolved before adding more handler types.

## Solution

Four sequential refactoring steps, each self-contained, followed by automated verification.

## Architecture

### Step 1: Define `HandlerExecutionContext`

**File:** `src/attractor/handlers/registry.ts`

Add a typed interface replacing the untyped `meta` bag:

```typescript
export interface HandlerExecutionContext {
  logsRoot: string;
  cwd: string;
  dotDir: string;
  signal?: AbortSignal;
  outgoingLabels: string[];
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  onStdout?: (s: NodeJS.ReadableStream) => Promise<void>;
  onInteractiveRequest?: OnInteractiveRequest;
}
```

Update the `NodeHandler` interface signature from `execute(..., meta: Record<string, unknown>)` to `execute(..., ctx: HandlerExecutionContext)`. Update all implementing handler classes to use the typed context — all unsafe `meta["key"] as Type` casts are replaced by direct property access.

### Step 2: Resolve the dual registry

**File:** `src/attractor/handlers/registry.ts`

- Delete the module-level `handlers` Map and its three exports: `registerHandler`, `lookupHandler`, `clearHandlers`
- Keep `buildHandlerMap()` in `engine.ts` as the single source of truth for handler registration
- `registry.ts` is repurposed to contain only: the `NodeHandler` interface and the `HandlerExecutionContext` type

**File:** `src/attractor/core/engine.ts`

- No changes needed — `buildHandlerMap()` already works independently

### Step 3: Extract `buildCommonArgs()`

**File:** `src/cli/lib/agent.ts`

Extract the shared prefix (model flag, permission mode, tools flags, MCP config) into a private `buildCommonArgs()` method. Both `buildArgs()` and `buildInteractiveArgs()` call it, then append their mode-specific flags. This is a ~20-line change that prevents future flag-addition bugs.

### Step 4: Extract `parseStructuredOutput()`

**New file:** `src/cli/lib/parse-structured-output.ts`

Extract the JSON-array-vs-NDJSON detection and parsing logic into a shared utility:

```typescript
export function parseStructuredOutput(rawText: string): unknown[];
```

Both `agent-handler.ts` and `agent.ts` import and call this function instead of maintaining their own inline implementations.

## Data Flow

```
engine.ts                  handler implementations
    |                              |
    |  buildHandlerMap()           |
    |  (single registry)           |
    v                              v
NodeHandler.execute(          HandlerExecutionContext
  node, ctx, context)    <--  (typed, no casts)
                                   |
                                   v
                          parseStructuredOutput()
                          (shared utility for JSON/NDJSON)
```

## Verification

### Step 5: Grep verification

After steps 1-2, run:
```bash
grep -r 'meta\[' src/attractor/handlers/
```
Any surviving untyped key access or cast (`as string`, `as AbortSignal`, etc.) indicates an incomplete `HandlerExecutionContext` type and must be fixed.

### Step 6: Smoke pipeline regression tests via tmux

After all implementation is committed, run every smoke pipeline through the engine using the tmux harness (consult `docs/harness/tmux-drive.md` for authoritative patterns):

- `pipelines/smoke/chat-only.dot`
- `pipelines/smoke/agent-implement.dot`
- `pipelines/smoke/gate.dot`
- `pipelines/smoke/tool.dot`
- `pipelines/smoke/chat-end-to-end.dot`
- `pipelines/smoke/conditional.dot`
- `pipelines/smoke/meditate-steer.dot`

Each must complete without error. Any failure is a blocking regression that must be fixed before completion. This is non-negotiable — the refactoring touches handler execution and registry code that every pipeline depends on.

## Files Touched

| File | Change |
|------|--------|
| `src/attractor/handlers/registry.ts` | Add `HandlerExecutionContext` type; update `NodeHandler` interface; delete dead `registerHandler`/`lookupHandler`/`clearHandlers` exports and module-level Map |
| `src/attractor/handlers/agent-handler.ts` | Use typed `HandlerExecutionContext`; replace inline JSON/NDJSON parsing with `parseStructuredOutput()` import |
| `src/attractor/handlers/*.ts` (all handlers) | Update `execute()` signature to use `HandlerExecutionContext` instead of `meta: Record<string, unknown>` |
| `src/attractor/core/engine.ts` | Update `meta` object construction to satisfy `HandlerExecutionContext` type |
| `src/cli/lib/agent.ts` | Extract `buildCommonArgs()`; call from both `buildArgs()` and `buildInteractiveArgs()` |
| `src/cli/lib/parse-structured-output.ts` | **New file** — shared `parseStructuredOutput()` utility |

## Constraints

- YAGNI / KISS — only the changes described above, no extra abstractions
- Existing tests must continue to pass (`npm test`)
- No new files beyond the shared `parseStructuredOutput` utility in step 4
- Step ordering matters: 1 before 2 (type must exist before cleaning registry), 3 and 4 are independent of each other but both come after 1-2

## Out of Scope

- Adding new handler types or node shapes
- Changing pipeline DOT file syntax
- Refactoring `engine.ts` beyond handler map construction
- Any changes to the variable expansion system
- Dynamic handler registration at runtime (YAGNI)
