# Triage Chat Notes — undefined-variables-silently-contaminate-prompts

## Illumination
`meditations/illuminations/2026-04-14T2100-undefined-variables-silently-contaminate-prompts.md`

## User Constraints

1. Pipeline errors must produce clear, visible messages — never silently hide failures. The developer needs to know what broke and where.
2. On error, the pipeline must shut down gracefully — no dangling agent processes, no half-finished state.
3. Error output must be a debuggable trace: which node failed, which variable was undefined, which path was taken, and the full variable context at the point of failure. Enough to reproduce and fix without re-running.
4. `pipeline validate` command should catch structural issues (undefined variable paths, missing producers, unreachable nodes) before the pipeline ever runs.

## Agreed Design Principle

**Undefined variables must warn loudly and default to empty, never pass through silently.**

## Agreed Priority & Scope

### Step 1 (highest priority): Fix `expandVariables` fallback + add warning
- Change `return match` to `return ""` for undefined variables in `src/attractor/transforms/variable-expansion.ts`
- Add a visible warning log when an undefined variable is encountered, including the variable name and which node's prompt triggered it
- Update the existing unit test that currently asserts the broken behavior (`'leaves unknown variables as-is'`)

### Step 2: Add `variable_coverage` rule to existing `validateGraph()` in `src/attractor/core/graph.ts`
- `ralph pipeline validate` already exists (`pipelineValidateCommand` in `src/cli/commands/pipeline.ts:28-54`) and calls `validateGraph()` (`graph.ts:234-294`)
- Current checks: start/exit nodes, reachability BFS, edge targets, condition syntax, handler types — but **zero variable awareness**
- Add a new `variable_coverage` diagnostic rule that:
  1. Scans each node's `prompt` field for `$variableName` references
  2. Identifies which nodes produce each variable (from `jsonSchemaFile` output fields)
  3. Checks whether every path to a consuming node passes through at least one producer
  4. Flags unguarded cross-path dependencies as warnings
- Produces clear messages like: "Node `design_writer` references `$refinements` but path `Approve` bypasses all producers"
- `validateOrRaise()` (called by `pipelineRunCommand` at runtime) will also surface these at run time

### Step 2b: Graceful shutdown + debuggable trace on runtime errors
- When a pipeline error occurs (e.g. undefined variable at expansion time), stop execution cleanly — tear down running agents, no orphan processes
- Emit a structured error trace: node name, variable name, path taken to reach the node, full variable context at failure point
- Enough information to reproduce and fix without re-running the pipeline

### Step 3: Fix `illumination-to-plan.dot`
- Guard `$refinements` with a default empty value or conditional prompt prefix
- Secondary to steps 1-2 since those make the fix systematic

### Step 4: Fix `chat-notes.md` cross-run contamination
- Use run-scoped or illumination-scoped path instead of global file
- Prevents stale data from previous runs bleeding into current summaries

### Step 5: Regression test for Approve-without-Chat path
- Assert `design_writer` prompt never contains literal `$refinements`
- Must fail before fix, pass after

## Constraints
- YAGNI / KISS — only the changes described above
- Existing tests must continue to pass (`npm test`)
- All pipeline smoke tests must pass after changes
