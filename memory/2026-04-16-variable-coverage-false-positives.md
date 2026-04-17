# variable_coverage False Positive Warnings in Pipeline Validation

**Date:** 2026-04-16
**Status:** Fixed 2026-04-16
**Severity:** Medium (breaks --strict flag, clutters validate output)

## Problem Statement

`ralph pipeline validate` runs `validateGraph` from `src/attractor/core/graph.ts` and issues `variable_coverage` warnings for pipeline variables that appear to have no producer. These warnings are false positives in two categories.

## Root Cause Analysis

The static validator constructs a `nodeProduces` map by inspecting only:

1. **TYPE_PRODUCES map** — hardcoded tool→output mappings (e.g., `store` → `store.path`, `wait.human` → `chat.output`)
2. **Interactive nodes** — `node.interactive=true` registers `chat.output`
3. **Explicit produces attribute** — `produces="var1, var2"` on any node (already implemented in code, lines 322–327, but undocumented and unused)

### What it does NOT read:

- **json_schema_file contents** — agent nodes emitting structured JSON (e.g., `verifier` with schema defining `preferred_label, illumination_path, summary, explanation`) have no registered producer
- **run_id in RESERVED_VARS** — the engine injects `$run_id` before pipeline start (like `$goal` and `$project`), but it's missing from the reserved list

## False Positive Categories

### Category 1: Agent JSON Schema Outputs
Variables like `$illumination_path`, `$summary`, `$explanation`, `$design_doc_path`, `$refinements` are produced by agent nodes via `json_schema_file` at runtime but invisible to static analysis.

**Example:** `pipelines/illumination-to-plan.dot` generates 20+ false warnings for vars defined in agent schemas.

### Category 2: Engine Builtins
`$run_id` is injected by the engine before pipeline start (documented in `src/attractor/core/engine.ts`), same as `$goal` and `$project`, but not in `RESERVED_VARS`.

## Existing Escape Hatch

The `produces=` attribute is already implemented and functional. Any node can declare:
```dot
[produces="var1, var2, var3"]
```

This is read and registered in `validateGraph` at lines 322–327 but is **undocumented and not used in existing pipelines**.

## Proposed Fixes

### Short-term (immediate, 1-line fix)
Add `run_id` to `RESERVED_VARS` in `src/attractor/core/graph.ts` (alongside `goal` and `project`).

### Medium-term (manual, per-pipeline)
Add `produces=` attributes to agent nodes in affected pipelines (e.g., `illumination-to-plan.dot`):
```dot
verifier [type="agent", produces="preferred_label, illumination_path, summary, explanation"]
```

### Long-term (structural, requires refactor)
Pass `dotDir` to `validateGraph` so it can:
1. Parse `json_schema_file` paths relative to the dot file location
2. Read schema definitions
3. Auto-infer produced variables
4. Eliminate manual `produces=` declarations

## Files Involved

- **Validator:** `src/attractor/core/graph.ts` (validateGraph, RESERVED_VARS, nodeProduces logic)
- **Example pipeline with false positives:** `pipelines/illumination-to-plan.dot` (~20+ warnings)
- **Related smoke test:** `pipelines/smoke/missing-caller-var.dot` (uses `inputs=` attribute for pre-flight checks)

## Decision Point

Current state is acceptable: the escape hatch exists and works. Recommend adding `run_id` to RESERVED_VARS (trivial fix) and documenting the `produces=` attribute in a pipeline authoring guide. Long-term structural fix can be deferred pending validator redesign.

## Tags
`validation`, `false-positives`, `static-analysis`, `json-schema`, `agent-outputs`
