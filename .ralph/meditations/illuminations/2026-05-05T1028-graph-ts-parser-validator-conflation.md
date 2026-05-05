---
date: 2026-05-05
description: graph.ts is 1134 lines mixing parseDot with validateGraph + 11 check* validation rules; validator orchestrator hides behind a file named for the parser.
---

## Files

- `src/attractor/core/graph.ts` (1134 lines) — `parseDot` + `resolveHandlerType` + `validateGraph` + 11 internal `check*` rules (`checkOrphanOutput`, `checkOutputsSchemaShape`, `checkInputTypeMismatch`, `checkRequiredCallerVars`, `checkMissingInputProducer`, `checkAgentOutputsConflict`, `checkAgentMissingOutputs`, `checkLoopRequiresDoneField`, `checkGateHandlers`, etc.)
- `src/attractor/core/flow-analyzer.ts` (158 lines) — produced/scope-vars helpers consumed by validator rules
- `src/attractor/core/conditions.ts` — clause parsing consumed by validator rules
- Imports cross-cutting into validator: `src/cli/lib/agent-loader.ts`, `src/cli/lib/gate-registry.ts`

## Problem

`parseDot` (string → `Graph`) and `validateGraph` (`Graph` → `Diagnostic[]`) are two different jobs. Today they share a file because they share types. The validator is the actual centre of gravity — 11 check rules + flow-analyzer + conditions + agent-loader + gate-registry all converge in `validateGraph`. The file's name suggests a parser; the bulk is a validator orchestrator.

This is **bloat**, not shallowness — but it has the same locality cost: reading "what does rule X check" requires scanning past unrelated parser code, and adding a 12th rule means another function in an already-1134-line file. Janitor illumination `2026-05-01T0344-janitor-pipeline-run-monolith.md` flagged the same monolith pattern in `pipeline.ts` and was acted on; this is the parallel case for `graph.ts`.

## Solution

Pull the validator out:

- New `src/attractor/core/graph-validator.ts` (or one-rule-per-file under `src/attractor/core/checks/`) owns `validateGraph` + all `check*` rules + their `flow-analyzer` / `conditions` / `agent-loader` / `gate-registry` calls.
- `graph.ts` keeps `parseDot`, `resolveHandlerType`, type definitions, and shared traversal helpers.
- Engine, CLI, and tests import the two modules independently.

If splitting per-rule, each `check*.ts` owns the flow-analyzer query it needs; rules become discoverable by filename.

## Benefits

- **Locality per concern:** parsing bugs and validation bugs stop colliding in one file. Each rule's preconditions live next to its assertion.
- **Test surface:** validator tests stop transitively re-testing the parser. Adding a rule = one file, not editing a 1134-line file.
- **Leverage:** validator becomes an inspectable seam — checkpoint for adding new rules, swapping diagnostics format, or running rules in isolation.
- **Discoverability:** "where do I add a new pipeline-validation rule?" has a one-word answer.
