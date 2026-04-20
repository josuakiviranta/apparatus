---
date: 2026-04-20
status: open
description: `ralph pipeline validate` mixes blocking structural errors with non-blocking style/maintainability warnings (portability heuristics, dead nodes, missing labels) — splitting into `validate` (errors only, CI gate) and `lint` (warnings, advisory) keeps the hard gate stable while letting lint evolve aggressively without breaking CI every time a new heuristic ships.
---

## Core Idea

`pipelineValidateCommand` at `src/cli/commands/pipeline.ts:84-165` runs `validateGraph` (`src/attractor/core/graph.ts:52`) and flows both `severity: "error"` and `severity: "warning"` diagnostics through the same return path. The command prints warnings then errors (`pipeline.ts:124-125`) and returns exit 0 iff `errors.length === 0 && !diffHasError && !unresolvedAgentBodyRefs` (`pipeline.ts:160-164`) — so today, **warnings are non-blocking**: the command succeeds with warnings present.

`validateGraph` already emits a mixed bag:

- **Errors:** `start_node`, `terminal_node`, `reachability`, `edge_target_exists`, `edge_source_exists`, `condition_syntax`, `type_unsupported`, plus schema errors from zod (`graph.ts:65-329`).
- **Warnings:** `type_known` unknown-handler hint (`graph.ts:141`), two unnamed rules at `graph.ts:251,264`, `portability_heuristic` for project-local path substrings (`graph.ts:273-282`), and the trailing one at `graph.ts:360`.

The shape is coherent — severity is already a first-class field on `Diagnostic` — but there is no way to ask *"is this pipeline lint-clean?"* independent from *"is this pipeline structurally valid?"*. CI can only gate on the union.

Problem shape:

1. When a new warning rule ships (portability, unused produces, dead nodes, `label_missing`), it fires on every pipeline in every consumer project. If a future CI recipe flips warnings to fatal, every new rule breaks that CI. If warnings stay advisory, they're easily ignored — the signal drowns.
2. Blocking and advisory checks have different iteration speeds. Blocking must be conservative (prefer missed rules to false-positives). Advisory can be opinionated (false-positives tolerable, authors silence or fix).
3. Semantic checks proposed in `2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md` (agent-name lookups, path existence, variable coverage) sit ambiguously — some want to be errors (undeclared inputs), some warnings (unknown agent dir, possibly-shadowed heuristic).

## Why It Matters

The rule-count for pipeline validation will grow sharply over the next quarters: agent-name checks, path existence, path-sensitive var-flow (see `2026-04-20T1900-path-sensitive-var-flow-validator.md`), `consumes`/`produces` parity, cross-node portability, dead-node elimination, label consistency. Every one of these has a judgement call — *"error or warning?"* — and the wrong answer is costly in both directions:

- **Default-to-error:** each new rule breaks downstream CI on day one. Authors either pin ralph versions (stale tooling) or pressure us to demote rules back to warnings (design churn).
- **Default-to-warning:** warnings accumulate into noise. Authors learn to grep them out of CI output. Real warnings (a broken variable on one branch) hide inside dozens of stylistic ones.

Without lane separation there is no stable escape hatch. Two commands makes the judgement call explicit: `validate` is the hard gate (conservative, slow-moving), `lint` is the opinion layer (aggressive, fast-moving). Authors wire both into CI with different expectations.

## Revised Implementation Steps

1. **Tag every rule with a lane at source.** Extend `Diagnostic` in `src/attractor/types.ts` with `lane: "validate" | "lint"`. Update every `diags.push(...)` call site in `src/attractor/core/graph.ts` to specify the lane. No rule belongs to both. Migration mapping:
   - `validate` lane: `start_node`, `terminal_node`, `reachability`, `start_no_incoming`, `exit_no_outgoing`, `edge_target_exists`, `edge_source_exists`, `condition_syntax`, `type_unsupported`, all zod `schema_error` entries.
   - `lint` lane: `type_known`, `portability_heuristic` (`graph.ts:273-282`), the two unnamed warnings at `graph.ts:251,264`, the one at `graph.ts:360`.
2. **Split the CLI commands.** In `src/cli/program.ts`, register `pipeline lint` alongside `pipeline validate`. Extract the current diagnostic-rendering core of `pipelineValidateCommand` into a shared helper. The two command wrappers differ only in which lanes they surface and how exit code is computed:
   - `validate`: render `lane === "validate"`. Exit 0 iff zero errors in that lane. Warnings from the lint lane are hidden by default; `--show-warnings` includes them (display only — still non-blocking).
   - `lint`: render both lanes. Exit 0 iff zero diagnostics in the `lint` lane (regardless of severity) AND zero errors in the `validate` lane (strict superset of `validate`).
3. **Preserve agent-body preflight.** `unresolvedAgentBodyRefs` at `pipeline.ts:140-158` is semantically a validate-lane error (undeclared $var that will crash at runtime). Route it through the validate lane rather than a special case, so future refactors keep it in the hard gate.
4. **Path-sensitive var-flow integration.** When `2026-04-20T1900-path-sensitive-var-flow-validator.md` lands, its rules naturally populate both lanes: "missing on all paths" → `validate` (hard error), "missing on some paths with fallback available" → `lint` (advisory). The lane split is the delivery mechanism that lets it ship incrementally without flipping any CI red on day one.
5. **Unified renderer, separate defaults.** Keep `formatDiag` (`pipeline.ts:98-103`) single-sourced. Both commands use it. The commands differ only in filter + exit-code logic.
6. **Document the CI recipe.** One paragraph in `specs/pipeline.md`: "Add `ralph pipeline validate` as a blocking CI step. Add `ralph pipeline lint` as an advisory step (allow-failure or soft-gated). Warnings in the lint lane are expected to grow across ralph versions."

## Cross-Links

- `2026-04-20T1900-path-sensitive-var-flow-validator.md` — direct dependency. New var-flow rules will fan out across both lanes (missing-on-all-paths → validate, missing-on-some-paths → lint). The lane distinction is what lets those rules land incrementally without regressing consumer CI.
- `2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md` — this illumination proposed agent-name lookups, path existence, variable coverage, but did not separate lanes. The lane split is the delivery mechanism for those proposals: each new semantic rule is born in the lane appropriate to its confidence (certain = validate, heuristic = lint), without breaking the gate.
- `2026-04-20T2600-pipeline-smoke-harness-first-class.md` — smoke tests are the runtime counterpart. `validate` catches static errors, `lint` surfaces static warnings, smoke catches runtime regressions. The three together form the full quality gate; none of them alone is sufficient.
