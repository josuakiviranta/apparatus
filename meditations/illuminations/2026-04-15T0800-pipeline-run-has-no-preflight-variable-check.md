---
date: 2026-04-14
status: open
description: ralph pipeline run starts the Ink UI and begins executing nodes before checking whether $variables the pipeline expects from the caller have been provided — missing caller inputs only surface mid-run as cryptic UndefinedVariableError failures, after tokens have already been spent.
---

## Core Idea

`variableExpansionTransform` is called at pipeline startup with only `{ project }` as context. Its internal `expand()` function silently catches every `UndefinedVariableError` and leaves the original `$variable` string in the node attribute. The graph proceeds to the engine with unresolved `$variable` strings intact — no warning, no list of what's missing. The Ink UI mounts. Nodes begin executing. Handlers re-expand node attributes against the growing runtime context. When a node runs that references a variable the caller never provided and no prior node ever set, `expandVariables` throws `UndefinedVariableError` inside the handler. The engine catches it, formats an error, and returns `fail`. By then, every node before the failing one has already executed — consumed API tokens, spawned Claude sessions, written checkpoint files — and the user sees an error that names the missing variable but gives no guidance on how to provide it.

This is a distinct problem from T2100 (undefined variables from skipped branches). T2100 is a graph design defect: a variable is set on one branch and read on another. This is a caller contract defect: the pipeline requires inputs the caller never knew to provide. The two problems share the same error class but have different causes and different fixes.

## Why It Matters

Consumer projects running bundled pipelines (T2300) or org preset pipelines (T0700) are most exposed. They run pipelines they didn't write, with variable contracts they can't see. `ralph pipeline run illumination-to-plan` with no flags will mount the Ink UI, start the `verifier` node, and fail when `expandVariables("...analyze $illumination_path...", {})` throws — after a Claude session has been spawned. The error output names `$illumination_path` but doesn't say where to provide it. The user must read the DOT file to discover the flag syntax.

The evidence is in `src/attractor/transforms/variable-expansion.ts` lines 42–47:

```ts
try {
  return expandVariables(replaced, ctx);
} catch (e) {
  if (e instanceof UndefinedVariableError) return replaced; // ← silent drop
  throw e;
}
```

This catch is appropriate for the startup transform (you can't know which variables will be set by prior nodes yet), but it means the startup pass gives no diagnostic output at all. The caller gets zero information about what the pipeline needs before it starts running.

The `inputs` graph attribute proposed in T0000 is the right declaration surface, but its value is zero without a check that reads it before the engine starts. A pipeline that declares `inputs="illumination_path, model"` and a `pipelineRunCommand` that checks for those in the initial context closes the loop in a single, early, informative failure.

## Revised Implementation Steps

1. **Add a `scanUndeclaredCallerVars(graph, initialContext)` function** in `src/attractor/transforms/variable-expansion.ts`. It iterates all node attributes (`prompt`, `toolCommand`, `agentCommand`, any string attribute) in the graph looking for `$name` patterns still present after startup expansion. It compares each found name against `initialContext`. Variables not in `initialContext` that are also not produced by any node's `json_schema_file` outputs are flagged as missing caller inputs. Return them as a `string[]`. Keep this function pure — no side effects.

2. **Call `scanUndeclaredCallerVars` in `pipelineRunCommand`** (`src/cli/commands/pipeline.ts`) immediately after `variableExpansionTransform`, before `renderPipelineApp` is called. If the result is non-empty and the pipeline declares `inputs` (step 3), fail fast: print a structured error listing each missing variable, show the `--var key=value` syntax, and exit without mounting the Ink UI. If `inputs` is not declared, emit a warning (not error) so existing pipelines without `inputs` don't hard-break.

3. **Parse `inputs` as a graph-level attribute in `src/attractor/core/graph.ts`**. The attribute is already proposed in T0000; this step makes it real. Syntax: `inputs="illumination_path, model, output_dir"` on the `digraph` declaration. Store as `graph.inputs: string[] | undefined`. When present, the pre-flight check in step 2 becomes an error for any input listed in `inputs` that is absent from the initial context. Unlisted variables that happen to be missing still produce warnings — the `inputs` declaration is the explicit contract.

4. **Add `inputs` to the `pipelineListCommand` output** (`src/cli/commands/pipeline.ts`). After each pipeline's goal line, if `inputs` is declared, print them as `  requires: illumination_path, model`. This gives consumers a discoverable way to see what a pipeline needs before running it — in the same command they use to find pipelines.

5. **Update `PROMPT_pipeline_create.md`** with one new authoring instruction: "Always include an `inputs=` attribute on the `digraph` declaration listing every `$variable` your pipeline expects the caller to provide. Variables set by prior nodes (via `json_schema_file` outputs) are internal — do not list those." Add `inputs` to the annotated reference example. This makes the contract a first-class part of the authoring habit, not an afterthought.
