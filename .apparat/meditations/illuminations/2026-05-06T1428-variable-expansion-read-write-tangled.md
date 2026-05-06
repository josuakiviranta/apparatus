---
date: 2026-05-06
description: variable-expansion.ts exports six graph-coupled functions mixing read-only scanners (validator preflight) with write-mode expanders (runtime); validator pulls in the expander it never calls.
---

## Files

- `src/attractor/transforms/variable-expansion.ts` (207 LOC)

## Problem

The module exports six functions that look related but split cleanly along a read/write axis:

**Read-only (scanners):**
- `scanUndeclaredCallerVars(graph)` — preflight: list vars referenced but not declared
- `findVarReferences(node)` — locate `$var` references in node attrs

**Write-mode (expanders):**
- `expandVariables(text, ctx)` — substitute `$var` with values
- `extractDefaults(graph)` — pull `default_*` values into a map
- `variableExpansionTransform` — graph-mutating pass
- `transformGraph(graph)` — apply transforms

Both halves reach into `graph.inputs`, edge labels, and node attribute strings — they share the same domain knowledge of where variables can appear. But the consumers are disjoint:

- **`graph-validator.ts`** imports the *scanners* for preflight diagnostics. It never expands anything.
- **Pipeline runtime** imports the *expanders* to substitute values during execution.
- **`pipeline.ts`** imports both — once for preflight printing, once for expansion before runtime.

The validator currently transitively pulls in the expander code it never calls; tests for the scanner half must avoid accidentally exercising the expander half. Adding a new variable form (e.g. `${ns:key}`) means editing both halves with overlapping but non-identical regex/parse logic.

**Deletion test:** the module pulls its weight as a domain — variable references *are* a single concept. The split is along caller-axis, not domain-axis.

## Solution

Split into two modules behind a shared lower-level scanner:

- **`var-references.ts`** — pure read-only: `findVarReferences`, `scanUndeclaredCallerVars`. The single source of truth for "where can `$var` appear?"
- **`var-expander.ts`** — write-mode: `expandVariables`, `extractDefaults`, `variableExpansionTransform`, `transformGraph`. Imports `findVarReferences` from `var-references.ts` so the "where" knowledge stays in one place.

Validator imports `var-references.ts` only. Runtime imports `var-expander.ts`. CLI preflight imports `var-references.ts`; CLI expansion step imports `var-expander.ts`.

## Benefits

- **Locality:** the "where can a variable appear?" knowledge moves to one file shared by both halves; the parse-vs-substitute distinction stops being a per-function concern.
- **Leverage:** the validator stops importing 150+ lines of expansion code it never executes. New variable-form additions touch one scanner; expander inherits.
- **Tests:** scanner becomes pure (string/graph in, references out) — unit tests don't need an expansion context. Expander tests stop accidentally validating scan behavior.
- **Deletion test:** complexity concentrates — the split is along the natural read/write seam, not artificial. The shared scanner becomes the hot path; expander is a downstream consumer like everything else.
