---
id: spec-2026-04-14-portable-pipeline-schema-resolution
type: spec
created: 2026-04-14
status: draft
tags: [pipeline, schema, portability, engine, agent-handler]
---

# Portable Pipeline Schema Resolution

## Problem

`json_schema_file` paths inside a `.dot` file are currently resolved relative to `--project` (the target project's cwd). This means a pipeline like `illumination-to-plan.dot` cannot be run against another project without also copying its schema files there:

```bash
# Fails — looks for ../jobs-post-worker/pipelines/schemas/verifier.json
ralph pipeline run ./pipelines/illumination-to-plan.dot --project ../jobs-post-worker
```

Schemas are part of the pipeline definition, not the target project. They should travel with the `.dot` file.

## Goal

Make pipelines self-contained. Running a `.dot` file from any directory against any `--project` should resolve schemas relative to where the `.dot` file lives, not where the target project is.

## Non-Goals

- Changes to how agent prompts resolve their runtime paths (e.g. `meditations/illuminations/*.md` in prompt text) — those are intentionally project-relative, executed by the agent inside the project context
- New DOT grammar or CLI flags
- Changes to how `--project` affects agent cwd

## Design

### Data flow

```
absPath = resolve(dotFile)               // e.g. /ralph-cli/pipelines/illumination-to-plan.dot
dotDir  = dirname(absPath)               // e.g. /ralph-cli/pipelines/
          ↓
runPipeline(graph, { cwd: project, dotDir, ... })
          ↓
meta["dotDir"] injected into each handler call
          ↓
agent-handler: readFileSync(resolve(dotDir, jsonSchemaFile), "utf8")
//                                   ^^^^^^ was: cwd (target project)
//                                   now:   dotDir (dot file's directory)
```

### Components

**`src/cli/commands/pipeline.ts`**

Compute `dotDir` from the already-resolved `absPath` and pass it to `runPipeline`:

```ts
import { dirname } from "path";

const dotDir = dirname(absPath);
await runPipeline(graph, { ..., dotDir });
```

**`src/attractor/core/engine.ts`**

Accept `dotDir?: string` in the options type. When building handler `meta`, set:

```ts
meta["dotDir"] = opts.dotDir ?? opts.cwd;
```

The `?? opts.cwd` fallback preserves current behaviour for callers that don't pass a dot file path (e.g. unit tests that call `runPipeline` directly).

**`src/attractor/handlers/agent-handler.ts`**

Replace the single schema resolution line:

```ts
// Before
jsonSchema = readFileSync(resolve(cwd, jsonSchemaFile), "utf8");

// After
const dotDir = meta["dotDir"] as string;
jsonSchema = readFileSync(resolve(dotDir, jsonSchemaFile), "utf8");
```

No other changes to the handler.

## Error Handling

No changes needed. The existing error message already surfaces the relative path:

```
Failed to read json_schema_file "pipelines/schemas/verifier.json": ENOENT ...
```

This remains accurate and sufficient to diagnose a missing schema.

## Testing

### Chunk 1 — Unit test (`agent-handler.test.ts`)

Add a test that passes `dotDir` pointing at a temp directory containing a minimal schema file, with `cwd` pointing at a different directory. Assert the schema is read from `dotDir`, not `cwd`.

Also verify the `dotDir ?? cwd` fallback: when `meta["dotDir"]` is absent, schema resolution falls back to `cwd` (existing behaviour).

### Chunk 2 — Update existing tests

Audit existing tests that call `runPipeline` or `AgentHandler.execute` with `json_schema_file`. Add `meta["dotDir"]` where missing, or confirm the fallback covers them.

### Chunk 3 — Tmux smoke test

Drive ralph inside tmux using the harness (`docs/harness/tmux-drive.md`):

1. Start a run: `ralph pipeline run ./pipelines/illumination-to-plan.dot --project ../jobs-post-worker`
2. Capture TUI output and assert no "Failed to read json_schema_file" error appears
3. Assert the pipeline progresses past the `verifier` node (reaches `explainer` or `done`)
4. Teardown via `cleanup_run`

This test lives in its own chunk so it can be iterated independently from the unit tests.

## Backwards Compatibility

`dotDir` is optional in `runPipeline` options. When absent, the engine defaults `dotDir` to `cwd`, preserving the current resolution behaviour for all existing callers.
