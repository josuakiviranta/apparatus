# Store Node Handler Design

**Date:** 2026-04-14
**Status:** Approved
**Feature:** Pipeline `store` node type for writing context values to files

## Problem

Pipelines that generate structured output (cover letters, reports, transformed text) have no built-in way to persist that output to the filesystem. Authors must chain a `tool` node with a shell `write` command as a workaround, which is verbose and fragile.

## Solution

Add a `store` node handler that reads a value from the pipeline context and writes it to a file. File paths support runtime variable expansion so they can be computed dynamically from upstream node outputs.

## Usage

```dot
save [
  shape=cylinder,
  store_key="humanize.output",
  store_file="$output_dir/$slug.md"
]
```

- `store_key` — key in `ctx.values` to read (e.g. `"humanize.output"` or `"cover_letter"`)
- `store_file` — destination path; supports `$varname` expansion against `ctx.values`
- `shape=cylinder` is the standard DOT shape for storage; maps to type `"store"`
- Authors may also use `type="store"` directly on any shape

## Architecture

### Handler: `src/attractor/handlers/store.ts` (new, ~35 lines)

Implements `NodeHandler`:

1. Validate `node.storeKey` and `node.storeFile` are present; return `fail` if missing
2. Expand `node.storeFile` via `expandVariables(node.storeFile, ctx.values)` — resolves runtime variables like `$output_dir`, `$slug`
3. Read `ctx.values[node.storeKey]` — the content to write
4. If value is missing: return `{ status: "fail", failureReason: "store_key 'X' not found in context" }`
5. Create parent directory (recursive) and write file as utf-8
6. Return `{ status: "success", contextUpdates: { "store.path": resolvedPath } }`

Downstream nodes can read `$store.path` to know where the file was written.

### Engine changes (2 lines across 2 files)

- **`src/attractor/core/graph.ts`** — add `"cylinder": "store"` to `SHAPE_TO_TYPE` map
- **`src/attractor/core/engine.ts`** — add `handlers.set("store", new StoreHandler())` in `buildHandlerMap`

## Variable Expansion

The engine already has `expandVariables(s, ctx.values)` used by `AgentHandler` and `WaitHumanHandler`. `StoreHandler` follows the same pattern — no new utilities needed.

`store_key` is a plain context key lookup (`ctx.values[node.storeKey]`), not a variable expression, so it does not go through `expandVariables`.

## Files Touched

| File | Change |
|------|--------|
| `src/attractor/handlers/store.ts` | New file (~35 lines) |
| `src/attractor/core/graph.ts` | +1 line: `"cylinder": "store"` in `SHAPE_TO_TYPE` |
| `src/attractor/core/engine.ts` | +1 line: handler registration in `buildHandlerMap` |

No changes to `variable-expansion.ts`, `pipeline.ts`, or any existing handlers.

## Implementation Notes

- `node.storeKey` and `node.storeFile` are accessed via index signature (`Node` uses `[key: string]: unknown`). Cast explicitly: `const storeKey = node.storeKey as string | undefined`.
- `expandVariables` import path: `"../transforms/variable-expansion.js"` (consistent with `agent-handler.ts`).

## Error Cases

| Condition | Outcome |
|-----------|---------|
| `store_key` attribute missing | `fail` — "store_key attribute required" |
| `store_file` attribute missing | `fail` — "store_file attribute required" |
| `ctx.values[store_key]` not set | `fail` — "store_key 'X' not found in context" |
| Directory creation fails | `fail` — propagate fs error message |
| File write fails | `fail` — propagate fs error message |

## Out of Scope

- Multiple store targets per node (use sequential store nodes)
- Non-file backends (stdout, context accumulation) — YAGNI
- Appending to existing files — YAGNI
