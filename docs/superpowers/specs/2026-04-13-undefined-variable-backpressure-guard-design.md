# Undefined Variable Backpressure Guard — Design Spec

**Date:** 2026-04-13
**Status:** Draft
**Illumination:** `meditations/illuminations/2026-04-14T2100-undefined-variables-silently-contaminate-prompts.md`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Problem Statement](#2-problem-statement)
3. [Goals and Constraints](#3-goals-and-constraints)
4. [Architecture](#4-architecture)
5. [Components](#5-components)
6. [Data Flow](#6-data-flow)
7. [Error Trace Format](#7-error-trace-format)
8. [Testing Strategy](#8-testing-strategy)
9. [What This Does NOT Do](#9-what-this-does-not-do)

---

## 1. Overview

Pipeline variable expansion currently fails silently: when a variable like `$refinements` is undefined (because the producing node was skipped via branching), `expandVariables` returns the literal string `$refinements` with no warning. This contaminates downstream prompts and produces nonsensical agent output.

This spec adds three layers of defense:

1. **Static validation** — a `variable_coverage` rule in `validateGraph()` that detects unreachable variable producers before the pipeline runs.
2. **Runtime guard** — `expandVariables` throws on undefined variables instead of silently passing them through.
3. **Graceful shutdown with structured error traces** — when a runtime variable error occurs, the pipeline tears down cleanly and emits a debuggable trace.

Additionally, the stale `meditations/.triage/chat-notes.md` accumulation bug is fixed by scoping chat notes per-run.

## 2. Problem Statement

### 2.1 Silent Variable Passthrough

`expandVariables` in `src/attractor/transforms/variable-expansion.ts` (line 11) does:

```ts
if (v === undefined) return match;
```

This means any undefined variable silently becomes its own literal name in the expanded text. The existing test suite (`src/attractor/tests/transforms.test.ts`) asserts this behavior as correct ("leaves unknown variables as-is"), masking the bug.

### 2.2 Path-Dependent Variable Availability

In `illumination-to-plan.dot`, the `design_writer` node references `$refinements` (line 27). The sole producer of `$refinements` is `chat_summarizer`. The "Approve" edge from `approval_gate` bypasses `chat_summarizer` entirely, so on the Approve-without-Chat path, `$refinements` is never set. `design_writer` receives the literal text `$refinements` in its prompt.

### 2.3 Stale Chat Notes

`meditations/.triage/chat-notes.md` is written by `chat_session` and read by `chat_summarizer` at a global path with no cleanup between runs. Successive pipeline runs accumulate notes from prior illuminations, risking cross-contamination.

## 3. Goals and Constraints

### Goals

| # | Goal |
|---|------|
| G1 | Undefined variables produce visible errors, never silent passthrough |
| G2 | `ralph pipeline validate` catches variable coverage gaps before execution |
| G3 | Runtime variable errors trigger graceful shutdown (no orphan processes) |
| G4 | Error output is a structured, debuggable trace sufficient to reproduce without re-running |
| G5 | Chat notes are scoped per-run to prevent cross-illumination contamination |

### Constraints

| # | Constraint |
|---|-----------|
| C1 | Errors must produce clear visible messages, never silently hide |
| C2 | Pipeline must shut down gracefully on error (tear down running agents, no orphan processes) |
| C3 | Error output must be a debuggable trace sufficient to reproduce without re-running |
| C4 | `pipeline validate` should catch structural issues before the pipeline runs |

## 4. Architecture

### Affected Files

| File | Change |
|------|--------|
| `src/attractor/transforms/variable-expansion.ts` | Throw on undefined variables instead of silent passthrough |
| `src/attractor/graph.ts` (`validateGraph`) | Add `variable_coverage` rule |
| `src/attractor/engine.ts` (or equivalent runner) | Graceful shutdown + error trace on runtime failures |
| `src/attractor/tests/transforms.test.ts` | Fix test that asserts broken behavior; add undefined-variable-throws test |
| Pipeline dot files referencing optional variables | Add default values or conditional guards |

### Layered Defense Model

```
Layer 1: Static Validation (pre-run)
  validateGraph() → variable_coverage rule
  Runs at: ralph pipeline validate, validateOrRaise() before every run

Layer 2: Runtime Guard (per-expansion)
  expandVariables() → throws UndefinedVariableError
  Runs at: every node prompt expansion

Layer 3: Graceful Shutdown (on error)
  Engine catches UndefinedVariableError → tears down agents → emits trace
  Runs at: pipeline execution error boundary
```

## 5. Components

### 5.1 Variable Coverage Rule (`validateGraph`)

Add a new diagnostic rule to the existing `validateGraph()` function at `src/attractor/graph.ts:234-294`. The infrastructure is already in place:

- `pipelineValidateCommand` at `pipeline.ts:28-54` parses the dot and runs `validateGraph()`
- `validateOrRaise()` at `graph.ts:296-302` is called before every pipeline run
- The new rule slots in alongside the existing 6 structural rules

**Algorithm:**

1. For each node, extract all `$variableName` references from its prompt/config.
2. For each referenced variable, find all nodes that produce it (set it in their output).
3. For each producing node, verify that at least one path from `start` to the consuming node passes through the producing node.
4. If no such path exists on any branch, emit a warning: "Variable `$X` referenced by node `Y` may be undefined on path(s) that skip node `Z`."

**Severity:** Warning (not error) at validate-time — the pipeline author may intend optional variables with defaults. Error at runtime if the variable is actually undefined during expansion.

### 5.2 Runtime Guard (`expandVariables`)

Replace the silent passthrough in `variable-expansion.ts`:

```ts
// Before (broken)
if (v === undefined) return match;

// After
if (v === undefined) {
  throw new UndefinedVariableError(variableName, nodeName);
}
```

Introduce a typed error class:

```ts
export class UndefinedVariableError extends Error {
  constructor(
    public readonly variableName: string,
    public readonly nodeName: string,
  ) {
    super(`Undefined variable $${variableName} in node "${nodeName}"`);
    this.name = 'UndefinedVariableError';
  }
}
```

**Default values:** Pipeline authors who want optional variables can declare defaults in the DOT node attributes (e.g., `default_refinements="No refinements provided."`). `expandVariables` checks for a default before throwing. This keeps the common case strict while allowing intentional optionality.

### 5.3 Graceful Shutdown + Error Trace

When the pipeline engine catches an `UndefinedVariableError` (or any pipeline-fatal error):

1. **Halt dispatch** — stop dispatching new nodes.
2. **Tear down running agents** — send termination signals to any in-flight agent processes. Wait for graceful exit with a timeout, then force-kill.
3. **Emit structured error trace** — write to stderr and to a trace file.

### 5.4 Chat Notes Scoping

Replace the global path `meditations/.triage/chat-notes.md` with a per-run scoped path, e.g., `meditations/.triage/<run-id>/chat-notes.md`. Clean up after the run completes (or on pipeline error teardown).

## 6. Data Flow

```
Pipeline Start
  │
  ├─ validateOrRaise()
  │    └─ validateGraph()
  │         └─ variable_coverage rule
  │              └─ WARN if $var may be undefined on any path
  │
  ├─ Execute nodes...
  │    └─ Node prompt expansion
  │         └─ expandVariables(template, context)
  │              ├─ $var found in context → substitute
  │              ├─ $var has default → substitute default
  │              └─ $var undefined, no default → throw UndefinedVariableError
  │
  └─ On UndefinedVariableError:
       ├─ Halt dispatch
       ├─ Tear down running agents
       └─ Emit error trace → stderr + trace file
```

## 7. Error Trace Format

```
PIPELINE ERROR: Undefined variable
─────────────────────────────────────
Node:       design_writer
Variable:   $refinements
Producer:   chat_summarizer
Path taken: start → verifier → explainer → approval_gate → [Approve] → design_writer
Skipped:    chat_session → chat_summarizer

Variable context at failure:
  $goal = "Triage an illumination..."
  $summary = "On any pipeline path..."
  $explanation = "All technical claims..."
  $refinements = <UNDEFINED>

Trace file: meditations/.triage/<run-id>/error-trace.json
```

## 8. Testing Strategy

### Unit Tests

| Test | File |
|------|------|
| `expandVariables` throws `UndefinedVariableError` for undefined vars | `transforms.test.ts` |
| `expandVariables` substitutes default values when provided | `transforms.test.ts` |
| `variable_coverage` rule detects unreachable producer | `graph.test.ts` |
| `variable_coverage` rule passes when all paths cover variables | `graph.test.ts` |
| Existing "leaves unknown variables as-is" test updated to expect throw | `transforms.test.ts` |

### Scenario Tests

| Scenario | Description |
|----------|-------------|
| Approve-without-Chat path | Run `illumination-to-plan.dot` via Approve path, verify pipeline either uses default or errors cleanly |
| Stale chat notes | Run two successive pipelines, verify second run does not see first run's chat notes |
| Graceful shutdown | Trigger `UndefinedVariableError` during execution, verify no orphan processes remain |

## 9. What This Does NOT Do

- **Template syntax changes** — `$variableName` syntax stays the same. No new interpolation grammar.
- **Automatic variable inference** — the validator does not infer variable names from node handler code; it relies on explicit declarations in the DOT file.
- **Retry or fallback** — undefined variables are errors, not retryable conditions. The pipeline stops.
- **Breaking existing valid pipelines** — pipelines where all variables are defined on all paths are unaffected.
