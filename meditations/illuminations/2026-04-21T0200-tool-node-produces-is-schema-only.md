---
date: 2026-04-21
status: open
description: ToolNodeSchema.produces is documented as "context key under which tool stdout is stored" but the handler never reads it — tool output always lands in tool.output, making T0100's capture_pre_sha and compute_changed_surfaces nodes silently broken as written.
---

## Core Idea

`ToolNodeSchema` declares a `produces` attribute with description "Context key under which the tool stdout is stored." The handler in `src/attractor/handlers/tool.ts` never reads it. Tool output always writes to `"tool.output"` (plus optional JSON-parsed keys when `produces_from_stdout=true`). The `produces` field exists in the schema so the validator doesn't reject it — but at runtime it is a no-op.

T0100's proposed SHA bookend nodes both rely on `produces=` to name their output:

```dot
capture_pre_sha [type="tool", ..., produces_from_stdout=true, produces="pre_implement_sha"]
compute_changed_surfaces [type="tool", ..., produces_from_stdout=true, produces="changed_files"]
```

Two compounding failures on each:

1. `produces_from_stdout=true` parses the **last stdout line as JSON**. `git rev-parse HEAD` emits a plain SHA; `git diff --name-only ... | tr` emits plain text. Neither is JSON. The handler emits `console.warn` and skips the parse. No named variable is written.
2. `produces="pre_implement_sha"` / `produces="changed_files"` — handler ignores these entirely. Variables remain undefined in context.

Downstream: `compute_changed_surfaces`'s command expands `$pre_implement_sha` to empty string, turning `git diff --name-only ..HEAD` into a syntax error.

## Why It Matters

T0100 is the current authoritative plan for fixing tmux_tester's context blindness (T2800–T3100 illumination chain). Its implementation steps would pass `ralph pipeline validate` — `produces` is a recognized schema key on tool nodes — but fail silently at runtime. `$pre_implement_sha` and `$changed_files` would both be empty at every downstream node. `tmux_tester` would fall back to `git log` heuristics exactly as before.

The validator gives false confidence. The schema description is aspirational. The handler gap is two lines of code.

## Revised Implementation Steps

1. **Implement `produces` in `ToolHandler.execute()`** (`src/attractor/handlers/tool.ts`). In `buildUpdates`, after writing `"tool.output"`, check `node.produces` (single key, no comma-list): if set, also write `ctx[node.produces] = stdout`. This is the smallest fix and makes the schema description match reality:
   ```ts
   const produces = (node as unknown as { produces?: string }).produces;
   const updates: Record<string, unknown> = { "tool.output": stdout };
   if (produces) updates[produces] = stdout;
   if (producesFromStdout) { /* existing JSON parse */ }
   ```

2. **Fix `capture_pre_sha`** in `pipelines/illumination-to-implementation.dot` — drop `produces_from_stdout=true` (plain-text SHA is not JSON); keep `produces="pre_implement_sha"` now that step 1 makes it work:
   ```dot
   capture_pre_sha [type="tool", cwd="$project",
                    tool_command="git -C $project rev-parse HEAD",
                    produces="pre_implement_sha"]
   ```

3. **Fix `compute_changed_surfaces`** — same pattern; drop `produces_from_stdout=true`, use `produces="changed_files"`:
   ```dot
   compute_changed_surfaces [type="tool", cwd="$project",
                              tool_command="git -C $project diff --name-only $pre_implement_sha..HEAD | tr '\\n' ','",
                              produces="changed_files"]
   ```

4. **Add a unit test** in `src/attractor/tests/tool-handler.test.ts` for the new `produces` behavior: tool node with `produces="my_var"` and stdout `"hello"` → context contains `my_var = "hello"`. One test, one assertion. Guard this in CI before the pipeline nodes land.

5. **Update the validator's variable-coverage pass** — once `produces` is live on tool nodes, the path-sensitive validator (T1900) can treat tool `produces` the same as agent `produces` when building the set of variables guaranteed to be in context on a given path. Without this, the coverage checker will still flag `$pre_implement_sha` as potentially-undefined even after the implementation lands.
