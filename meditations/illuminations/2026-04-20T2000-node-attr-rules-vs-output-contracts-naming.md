---
date: 2026-04-20
status: open
description: Two separate validation layers both called "schema" confuse authors — `src/attractor/core/schemas.ts` validates DOT node attribute shape, and `pipelines/schemas/*.json` validates agent structured-output contracts — they answer different questions at different times, and the shared name makes authors believe one implies the other.
---

## Core Idea

Ralph has two validation layers and both are called "schema". They check different things at different phases:

| Location | What it validates | When it runs |
|---|---|---|
| `src/attractor/core/schemas.ts` (zod, per node-kind) | DOT attribute keys and types | At `pipeline validate` and `pipeline run` load time |
| `pipelines/schemas/*.json` (JSON Schema) | Agent LLM structured-output fields | At runtime, after agent emits final message |

The first governs the graph source file. The second governs what a particular LLM call is allowed to return. They never overlap in scope, but they share a word, and the word leaks into error messages, filenames, DOT attribute keys (`json_schema_file=…`), and authors' mental models.

Concrete evidence: in the triage session captured in `memory/2026-04-20-illumination-pipeline-triage-debug.md`, a user hit a `schema_error` from `ralph pipeline validate` complaining about attributes on a tool node. Their first instinct was to open `verifier.json` in `pipelines/schemas/` and look for the missing field. But `verifier.json` is an agent output contract for an unrelated node; the failure was a zod rejection of a `default_*` key on the tool node. Minutes lost, no code bug — pure naming collision.

The fix is terminology, not code.

## Why It Matters

This is a pure-UX direction: zero runtime behavior change, zero new features. ROI is clarity for every future pipeline author. The confusion compounds: every new agent adds a new JSON file that a reader may conflate with node validation, every new node-kind attribute adds a new zod rule that a reader may confuse with output contracts. Error messages cite "schema" and the author has to disambiguate by context every single time.

Related illuminations have already surfaced the same category of problem at other seams: `2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md` separated syntax from semantics for the *validator*; this illumination separates attribute-shape from output-contract for the word *schema*. Same "two distinct things sharing one label" failure mode at a different layer.

Downstream work also depends on clean vocabulary: `2026-04-20T1900-path-sensitive-var-flow-validator.md` will emit diagnostics that reference both concepts (a path-sensitive error might say "upstream agent's contract does not declare `$scope_changed`, and no NodeAttrRules `default_scope_changed` is set on the gate"); if both things are called "schema", the message cannot be written unambiguously. And `2026-04-20T2100-agent-scaffold-command.md` — a command that scaffolds both a new node and a new contract — is the concrete test of whether the two concepts are clearly separable in author workflow.

## Revised Implementation Steps

1. **Rename the zod layer to `NodeAttrRules`.** In `src/attractor/core/schemas.ts`, rename every exported zod object (`ToolNodeSchema` → `ToolNodeAttrRules`, `AgentNodeSchema` → `AgentNodeAttrRules`, `GateNodeSchema` → `GateNodeAttrRules`, etc.) and the file itself to `src/attractor/core/node-attr-rules.ts`. Update all importers: `src/attractor/core/graph.ts`, the validator, and tests under `src/tests/**`.

2. **Rename the folder and file pattern for agent contracts.** Move `pipelines/schemas/` → `pipelines/contracts/`. Rename the `*.json` files to `<agent>.contract.json` (e.g. `verifier.json` → `verifier.contract.json`). Update every `.dot` file: `grep -rn "json_schema_file=" pipelines/**/*.dot` identifies the call sites; rewrite to `contract_file=`.

3. **Update user-visible text.** Validator error messages currently say things like "schema_error: Unrecognized key(s) in object"; change to "attr_rules_error: …". Add a one-paragraph terminology box to `specs/pipeline.md` and README that pairs the two concepts side by side (table similar to this file's Core Idea).

4. **Backward compatibility for one release.** Keep the old DOT attribute `json_schema_file=` working alongside the new `contract_file=`. When the old form is used, the validator emits a `deprecated_attr` warning pointing at the new name. After one release, remove the alias. Document the deprecation window in `CHANGELOG.md`.

5. **Test the rename end-to-end.** Run `pipeline validate` across every pipeline in `pipelines/` and confirm no `schema_*` strings appear in any diagnostic. Add a regression test that asserts the validator error class names use `attr_rules_error` and never the bare word `schema`.
