# Pre-Flight Variable Check — Design Spec

**Date:** 2026-04-16
**Status:** Draft
**Illumination:** `meditations/illuminations/2026-04-15T0800-pipeline-run-has-no-preflight-variable-check.md`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Problem Statement](#2-problem-statement)
3. [Goals and Constraints](#3-goals-and-constraints)
4. [Architecture](#4-architecture)
5. [Components](#5-components)
6. [Data Flow](#6-data-flow)
7. [Error Output Format](#7-error-output-format)
8. [Authoring Contract](#8-authoring-contract)
9. [Testing Strategy](#9-testing-strategy)
10. [What This Does NOT Do](#10-what-this-does-not-do)
11. [Relationship to Prior Work](#11-relationship-to-prior-work)

---

## 1. Overview

`ralph pipeline run` mounts the Ink UI and starts executing nodes before verifying that the `$variables` the pipeline expects from its caller have been provided. Missing caller inputs only surface mid-run as `UndefinedVariableError` failures — after tokens have been spent, Claude sessions spawned, and checkpoints written.

This spec closes that gap with a **pre-flight caller-contract check**:

1. A first-class `inputs=` graph attribute declaring the caller contract in each DOT file.
2. A pure `scanUndeclaredCallerVars()` function that inventories `$variables` referenced by nodes but neither provided by the caller nor produced by a prior node.
3. An early failure in `pipelineRunCommand` that reports missing inputs before the Ink UI mounts.
4. Discovery surfaces: `pipeline list` prints the `requires:` line, and `PROMPT_pipeline_create.md` teaches authors to declare inputs up front.

## 2. Problem Statement

### 2.1 Silent Startup Expansion

`variableExpansionTransform` is invoked in `pipelineRunCommand` with only `{ project }` as context. Its internal `expand()` function catches every `UndefinedVariableError` and returns the unreplaced string:

```ts
// src/attractor/transforms/variable-expansion.ts (~lines 51–54)
try {
  return expandVariables(replaced, ctx);
} catch (e) {
  if (e instanceof UndefinedVariableError) return replaced; // silent drop
  throw e;
}
```

The catch is correct for a startup pass (prior-node producers haven't run yet), but the pass emits no diagnostic output. Unresolved `$var` tokens flow into the engine intact.

### 2.2 Late Failure After Side Effects

Handlers re-expand node attributes against the growing runtime context. When a node references a variable the caller never provided and no prior node ever set, `expandVariables` throws inside the handler. The engine catches it, marks the node failed, and halts — but every node before the failing one has already executed. Tokens, sessions, and checkpoint files are already consumed.

### 2.3 No Declared Contract

There is no way for a consumer to read what a pipeline requires. `pipelineListCommand` prints name + goal only. `parseDot` does not read a graph-level `inputs` attribute; `Graph` has no `inputs` field. The authoring prompt does not teach authors to declare caller inputs. A user running `ralph pipeline run illumination-to-plan` with no flags has no way to discover `$illumination_path` short of opening the DOT file.

### 2.4 Distinct From T2100

T2100 (undefined-variable backpressure guard, 2026-04-13 spec) addresses **graph design defects** — a variable set on one branch and consumed on another. This spec addresses **caller contract defects** — the pipeline requires inputs the caller never knew to provide. Same error class, different cause, different fix. The two are complementary: T2100 guards runtime, this guards startup.

## 3. Goals and Constraints

### Goals

| #  | Goal |
|----|------|
| G1 | Missing caller inputs fail fast, before the Ink UI mounts and before any agent/tool invocation |
| G2 | Error output names every missing variable and shows the exact `--var key=value` syntax to supply them |
| G3 | Each pipeline can declare its caller contract in a single, authoritative place (`inputs=` on the digraph) |
| G4 | `pipeline list` surfaces the contract so consumers discover requirements without opening the DOT |
| G5 | Authors are taught to declare `inputs=` by default via the creation prompt |
| G6 | Existing pipelines that do not yet declare `inputs=` continue to run (soft warning, not hard failure) |

### Constraints

| #  | Constraint |
|----|-----------|
| C1 | Pre-flight check must be pure (no side effects) and fast (no I/O beyond what is already done) |
| C2 | No template-syntax change — `$name` remains the substitution token |
| C3 | Variables produced by prior nodes (via `json_schema_file` outputs) are internal, not caller inputs |
| C4 | Must not double-fire with T2100's runtime guard — the two checks run at different phases |
| C5 | Declared-but-unused inputs are permitted silently (authors may over-declare for clarity) |

## 4. Architecture

### Affected Files

| File | Change |
|------|--------|
| `src/attractor/core/graph.ts` | Parse `inputs=` graph-level attribute into `graph.inputs: string[]` |
| `src/attractor/types.ts` | Add `inputs?: string[]` to `Graph` type |
| `src/attractor/transforms/variable-expansion.ts` | Export pure `scanUndeclaredCallerVars(graph, initialContext)` |
| `src/cli/commands/pipeline.ts` | Invoke pre-flight check in `pipelineRunCommand` after `variableExpansionTransform`, before `renderPipelineApp`; extend `pipelineListCommand` to print `requires:` |
| `src/cli/program.ts` | Wire `--var key=value` flag (repeatable) into `PipelineRunOptions.variables` |
| `src/prompts/PROMPT_pipeline_create.md` | Add authoring instruction + annotated `inputs=` example |
| Bundled pipelines in `src/pipelines/*.dot` | Add `inputs=` attribute where appropriate |

### Phase Model

```
Phase A: Parse        parseDot → graph (with graph.inputs populated)
Phase B: Startup      variableExpansionTransform(graph, { project, context })
Phase C: Pre-flight   scanUndeclaredCallerVars(graph, initialContext) ← NEW
Phase D: Mount UI     renderPipelineApp(...)
Phase E: Run          engine dispatches nodes; T2100 runtime guard active
```

The pre-flight check (Phase C) is the new gate. Phases A–B are unchanged in behavior. Phase D only runs if Phase C passes.

## 5. Components

### 5.1 `inputs=` Graph Attribute

DOT syntax — declared on the `digraph` statement alongside `goal=`:

```dot
digraph illumination_to_plan {
  goal="Triage an illumination into an approved design doc and implementation plan"
  inputs="illumination_path, model, output_dir"

  start -> verifier;
  ...
}
```

**Semantics:**
- Comma-separated list of `$variable` names (no `$` prefix in the declaration).
- Whitespace is trimmed. Empty/duplicate entries are ignored.
- The list is the **explicit caller contract**: every name must be provided by the caller (via `--var` or default context).
- Variables produced internally (via `json_schema_file` outputs of prior nodes) are **not** listed.

### 5.2 `scanUndeclaredCallerVars(graph, initialContext)`

Location: `src/attractor/transforms/variable-expansion.ts`. Pure function, no I/O.

**Signature:**
```ts
export function scanUndeclaredCallerVars(
  graph: Graph,
  initialContext: Record<string, string>,
): { missing: string[]; declared: string[]; undeclared: string[] };
```

**Algorithm:**
1. Collect every `$name` token appearing in any string node attribute (`prompt`, `toolCommand`, `agentCommand`, and future string attrs via a known-list or generic string walk).
2. Collect producer names: for every node with a `json_schema_file` (or equivalent output binding), add its declared output keys to a `producers` set.
3. For each referenced `$name`:
   - If `name ∈ initialContext` → satisfied.
   - Else if `name ∈ producers` → internal, ignore.
   - Else → missing.
4. Partition `missing` against `graph.inputs`:
   - `declared = missing ∩ graph.inputs` — listed in the contract but not supplied.
   - `undeclared = missing \ graph.inputs` — neither supplied nor declared.
5. Return all three lists (callers pick severity).

### 5.3 `pipelineRunCommand` Pre-Flight

Insert in `src/cli/commands/pipeline.ts` between the current `variableExpansionTransform` call (~line 80–83) and `renderPipelineApp` (~line 122–129):

```ts
const preflight = scanUndeclaredCallerVars(graph, opts.variables ?? {});

if (graph.inputs && preflight.declared.length > 0) {
  printMissingInputsError(graph, preflight.declared);
  process.exit(1);
}

if (!graph.inputs && (preflight.declared.length || preflight.undeclared.length)) {
  printMissingInputsWarning(preflight.undeclared);
  // continue — legacy pipelines without inputs= still run
}

if (graph.inputs && preflight.undeclared.length > 0) {
  // undeclared vars missing from a pipeline that DID declare inputs=
  // → author bug; warn loudly but do not block
  printUndeclaredWarning(preflight.undeclared);
}
```

**Rule of thumb:**
- `inputs=` declared **and** caller missed a declared var → **error, exit 1**.
- `inputs=` declared **and** pipeline references an undeclared var → **warn** (author oversight).
- `inputs=` not declared → **warn**, continue (legacy pipelines).

### 5.4 `pipelineListCommand` Discovery

Extend the per-pipeline print block in `pipelineListCommand`. After the `goal:` line, if `graph.inputs` is present and non-empty, print:

```
  requires: illumination_path, model, output_dir
```

Pipelines without `inputs=` print no `requires:` line (same as today). Output remains greppable.

### 5.5 `--var` Flag Wiring

`PipelineRunOptions.variables` already exists on the command options type but is not populated by the CLI parser. Add to `src/cli/program.ts` the `pipeline run` subcommand:

```ts
.option('--var <key=value>', 'pass caller variable (repeatable)', collectKV, {})
```

`collectKV` is a small accumulator (split on first `=`, build a record). No environment-variable fallback; stay explicit.

### 5.6 Authoring Prompt Update

In `src/prompts/PROMPT_pipeline_create.md`, add one instruction block under the DOT authoring rules:

> **Declare caller inputs.** Add an `inputs=` attribute to your `digraph` listing every `$variable` your pipeline expects the caller to provide. Variables set by prior nodes (via `json_schema_file` outputs) are internal — do not list those. Example: `inputs="illumination_path, model"`.

Extend the annotated reference pipeline in the prompt to include the `inputs=` line.

## 6. Data Flow

```
ralph pipeline run <name> [--var k=v ...]
  │
  ├─ parseDot(<name>.dot)              → graph (with graph.inputs)
  │
  ├─ variableExpansionTransform(graph, { project, context: opts.variables })
  │     └─ silent catch still in effect (correct at this phase)
  │
  ├─ scanUndeclaredCallerVars(graph, opts.variables)
  │     ├─ graph.inputs declared?
  │     │    ├─ declared.missing     → error, exit 1
  │     │    └─ undeclared.missing   → warn, continue
  │     └─ not declared?
  │          └─ any missing          → warn, continue
  │
  ├─ renderPipelineApp(...)           ← only reached when pre-flight passes
  │
  └─ engine runs; T2100 runtime guard handles late cases
```

## 7. Error Output Format

Pre-flight error (pipeline has `inputs=`, caller missed one):

```
PIPELINE ERROR: Missing required inputs
────────────────────────────────────────
Pipeline:   illumination-to-plan
Required:   illumination_path, model, output_dir
Provided:   model

Missing:
  $illumination_path
  $output_dir

Supply with:
  ralph pipeline run illumination-to-plan \
    --var illumination_path=<path> \
    --var output_dir=<path>
```

Pre-flight warning (legacy pipeline without `inputs=`):

```
PIPELINE WARNING: Pipeline references variables not in the caller context
  $illumination_path

The pipeline does not declare `inputs=`, so this is a best-effort check.
Proceeding anyway. If the run fails mid-pipeline, supply the variable with
`--var illumination_path=<value>` or add `inputs="..."` to the DOT file.
```

## 8. Authoring Contract

A pipeline's DOT file owns exactly one contract line:

```dot
inputs="<comma-separated caller-provided variable names>"
```

**Do list:** every `$name` the caller must pass.
**Don't list:** variables produced by `json_schema_file` outputs of prior nodes.
**Don't list:** variables already injected by the runtime (`$project`, etc. — reserved).

Authors who omit `inputs=` get warnings, not errors. Authors who misdeclare (list more or fewer than actually referenced) get warnings that name the mismatch.

## 9. Testing Strategy

### Unit Tests

| Test | File |
|------|------|
| `parseDot` reads `inputs="a, b, c"` into `graph.inputs = ["a","b","c"]` | `graph.test.ts` |
| `parseDot` leaves `graph.inputs` undefined when attribute absent | `graph.test.ts` |
| `scanUndeclaredCallerVars` returns `declared=[]` when all inputs supplied | `transforms.test.ts` |
| `scanUndeclaredCallerVars` returns missing names when inputs absent | `transforms.test.ts` |
| `scanUndeclaredCallerVars` ignores vars produced by `json_schema_file` outputs | `transforms.test.ts` |
| `scanUndeclaredCallerVars` partitions declared vs undeclared correctly | `transforms.test.ts` |

### Integration Tests

| Test | Expected |
|------|----------|
| `pipeline run <pipeline with inputs=>` missing `--var` | Exits 1, prints missing-inputs error, no Ink UI mount |
| `pipeline run <pipeline without inputs=>` missing var | Warns, continues (legacy compat) |
| `pipeline list` includes `requires:` line for pipelines with `inputs=` | Output contains `requires: illumination_path, ...` |
| `--var k=v` repeatable | Multiple `--var` flags merge into `opts.variables` |

### Scenario Tests

| Scenario | Description |
|----------|-------------|
| `missing-caller-var.dot` (new, in `pipelines/smoke/`) | Declares `inputs="required_var"`, references `$required_var` in one node. Running with no `--var` exits 1 before any agent runs. Running with `--var required_var=foo` succeeds. |
| Bundled `illumination-to-plan.dot` updated with `inputs=` | Existing scenario tests still pass when caller supplies required vars; fail fast when they don't. |

## 10. What This Does NOT Do

- **No runtime-guard changes.** T2100's `UndefinedVariableError` in handlers remains — it handles graph-design defects (branch-skipped producers) that the pre-flight check cannot detect.
- **No template-syntax change.** `$name` stays. No new interpolation grammar.
- **No environment-variable inference.** `--var` is the only caller channel. No implicit `$FOO` → `process.env.FOO`.
- **No auto-`inputs=` migration.** Legacy pipelines keep working via warnings; authors migrate by hand.
- **No schema/type checking on variable values.** All values are strings. Type coercion is the node handler's job.
- **No interactive prompting for missing inputs.** Fail fast; the caller re-runs with flags. Interactive flows belong to a separate, later spec.

## 11. Relationship to Prior Work

| Spec | Role |
|------|------|
| `2026-04-13-undefined-variable-backpressure-guard-design.md` (T2100) | Runtime guard: catches undefined vars during node execution (branch-skipped producers, graph design bugs). |
| `2026-04-11-pipeline-workflow-authoring-design.md` | Authoring surface this spec extends with the `inputs=` declaration. |
| `2026-04-14-portable-pipeline-schema-resolution-design.md` | Establishes the `json_schema_file` output-binding concept this spec uses to identify internal producers. |
| `2026-04-16-pipeline-context-observability-design.md` | Consumes the same context namespace; pre-flight errors should render through the same formatter stack when practical. |

This spec is the **caller-facing** complement to T2100's **node-facing** guard. Both are needed: pre-flight catches "you didn't provide X"; runtime catches "this branch skipped X's producer".
