# Design: Janitor — Unify Validator Field Lists With `STRING_ATTRS`

**Date:** 2026-05-04
**Status:** draft (pending review)
**Originating illumination:** `.ralph/meditations/illuminations/2026-05-01T0513-janitor-string-attrs-drift.md`

## 1. Motivation

`pipeline validate` is supposed to be the early-signal twin of `pipeline run`: catch authoring mistakes — including typos in `$var` references — before the pipeline starts spending agent budget. Today it has a silent blind spot. A `$var` reference inside a `cwd=` attribute slips past static analysis because two of the validator's field lists hardcode four attribute names (`prompt`, `toolCommand`, `label`, `scriptArgs`) instead of reading the canonical five-element list (`STRING_ATTRS`) the runtime already maintains.

The runtime expander does see `cwd=`. From `src/attractor/transforms/variable-expansion.ts:135-137`:

```ts
// String-valued node attributes the scanner must walk for $var references.
// Keep in sync with the fields list in graph.ts variable_coverage check.
const STRING_ATTRS = ["prompt", "toolCommand", "label", "scriptArgs", "cwd"];
```

The constant is exported one line later — `src/attractor/transforms/variable-expansion.ts:139`: `export { STRING_ATTRS };` — so the symbol is reachable. `graph.ts` simply does not import it. The current `graph.ts` import from `variable-expansion.ts` (line 4) pulls only `expandVariables, extractDefaults, UndefinedVariableError`.

The cost is asymmetry between two commands that the user thinks of as one workflow:

- `pipeline run` already errors on a typo'd `$var` inside `cwd=`. The runtime expansion path (`variableExpansionTransform` at `src/attractor/transforms/variable-expansion.ts:125`) walks `cwd` via `STRING_ATTRS`; an unknown variable surfaces as `UndefinedVariableError` or as a missing-input failure during graph evaluation.
- `pipeline validate` stays silent on the same typo, then the user runs the pipeline, eats the cost of getting partway through, and discovers the typo at runtime instead of pre-flight.

Validator hardening is an active theme on this branch: qualified-key unification and `checkOrphanOutput` resolution shipped on 2026-04-29 / 2026-04-30. This illumination was raised at the same time but not yet consumed. README documents `cwd=` as the contract anchor for tool nodes — `README.md:94-107` requires every `type="tool"` node to declare `cwd=` with `$project` / `$run_id` expansion — so validator blindness in that exact slot is a direct gap against the documented surface.

The "Keep in sync with the fields list in graph.ts variable_coverage check" comment at `src/attractor/transforms/variable-expansion.ts:135-136` already names the problem. The fix is import, not comment maintenance.

## 2. Decision Summary

1. **Import `STRING_ATTRS` in `src/attractor/core/graph.ts`** by extending the existing `import { … } from "../transforms/variable-expansion.js"` at line 4. Adds one symbol; no new import statement.
2. **Replace the hardcoded array at `src/attractor/core/graph.ts:260-265` (`variable_coverage` rule)** with iteration over `STRING_ATTRS`, mapping each attribute name to `(consumer as Record<string, unknown>)[attr]` and filtering to strings. Behavior widens to include `cwd`.
3. **Replace the hardcoded array at `src/attractor/core/graph.ts:647-648` (`checkOrphanOutput`)** with the same iteration shape over `STRING_ATTRS`. Behavior widens to include `cwd`.
4. **Retire the keep-in-sync comment at `src/attractor/transforms/variable-expansion.ts:135-136`** — the constraint it documents disappears once both consumers read the constant.
5. **Add one regression test** to the `variable_coverage` suite in `src/attractor/tests/graph.test.ts` (existing suite opens at line 544 and closes at line 799 today) covering a `$var` typo inside `cwd=`. The test is the artefact that locks the new behavior in place.

The fix is a *reduction* in hardcoded strings: two duplicated four-element arrays disappear; nothing new is hardcoded. Both validator sites become pure consumers of the already-exported runtime constant.

Out of scope (locked by the verifier sizing and the chat refinement log):

- The portability-heuristic scan at `src/attractor/core/graph.ts:333`. That scan deliberately checks only `prompt` and `toolCommand` — its concern is project-specific path substrings inside command-shaped fields, not variable references — and the illumination flagged it as a separate change. Verbatim from the file at line 333: `const fields = [node.prompt, node.toolCommand].filter((f): f is string => typeof f === "string");`. Out.
- `pipeline run` semantics. No new error paths, no changed messages, no behavior shift. The runtime path already handled `cwd=`; this design does not touch it. Out.
- Any other validator rule, schema, agent contract, CLI flag, or pipeline-engine surface. Out.

## 3. Architecture

### 3.1 Current shape

```
src/attractor/transforms/variable-expansion.ts
  ├── STRING_ATTRS (5 items, exported)              ← canonical list
  └── variableExpansionTransform                    ← uses STRING_ATTRS

src/attractor/core/graph.ts
  ├── import { expandVariables, extractDefaults,    ← STRING_ATTRS NOT imported
  │            UndefinedVariableError }
  ├── validateGraph → variable_coverage rule
  │     └── const fields = [prompt, toolCommand,    ← hardcoded copy A (4 items, no cwd)
  │                          label, scriptArgs]
  ├── validateGraph → portability_heuristic rule
  │     └── const fields = [prompt, toolCommand]    ← intentionally narrow, untouched
  └── checkOrphanOutput
        └── const fields = [prompt, toolCommand,    ← hardcoded copy B (4 items, no cwd)
                             label, scriptArgs]
```

Two hardcoded copies of the same conceptual list, kept in approximate sync by a comment. Both miss `cwd`.

### 3.2 Target shape

```
src/attractor/transforms/variable-expansion.ts
  ├── STRING_ATTRS (5 items, exported)              ← canonical list, unchanged
  └── variableExpansionTransform                    ← unchanged

src/attractor/core/graph.ts
  ├── import { expandVariables, extractDefaults,    ← STRING_ATTRS added
  │            UndefinedVariableError, STRING_ATTRS }
  ├── validateGraph → variable_coverage rule
  │     └── iterate STRING_ATTRS                    ← reads canonical (5 items)
  ├── validateGraph → portability_heuristic rule
  │     └── const fields = [prompt, toolCommand]    ← unchanged, still narrow
  └── checkOrphanOutput
        └── iterate STRING_ATTRS                    ← reads canonical (5 items)
```

One source of truth. The keep-in-sync comment at `src/attractor/transforms/variable-expansion.ts:135-136` is removed because nothing is left to keep in sync.

### 3.3 Code shape

For both validator sites, the field-collection step becomes:

```ts
const fields = STRING_ATTRS
  .map((attr) => (consumer as Record<string, unknown>)[attr])
  .filter((f): f is string => typeof f === "string");
```

Surrounding logic — the `VAR_RE` regex walk, the qualified-key handling, the diagnostics push — stays as-is. The change is strictly the source of the list.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/attractor/core/graph.ts` | Add `STRING_ATTRS` to existing import at line 4. Replace field array at lines 260-265 with iteration over `STRING_ATTRS`. Replace field array at lines 647-648 with iteration over `STRING_ATTRS`. |
| `src/attractor/transforms/variable-expansion.ts` | Delete the keep-in-sync comment at lines 135-136. The exported constant at line 137 and the `export` statement at line 139 stay. |
| `src/attractor/tests/graph.test.ts` | Add one test case in the `variable_coverage` suite (opens at line 544, closes at line 799 today) asserting that a `$var` typo inside `cwd=` produces a `variable_coverage` warning. Existing tests stay. |

No other file touched. No new file created. No file renamed or deleted.

## 5. Data flow

The validator's diagnostic pipeline is unchanged. Inputs (the parsed `Graph`) and outputs (the `Diagnostic[]` list) keep their existing shapes. The change happens entirely inside the field-collection step of two rules — `variable_coverage` and `checkOrphanOutput` — and propagates through their existing emission paths.

`pipeline run` data flow is byte-identical before and after. No node attribute is added, removed, or renamed; no expansion semantics change; no error code or message at runtime is affected.

## 6. Blast radius / impact surface

Sourced from the verifier's `Blast radius:` paragraph and the explainer's `## Blast radius` block.

- **Size:** S
- **Files touched:** 2 source files + 1 test file. `src/attractor/core/graph.ts` (edit), `src/attractor/transforms/variable-expansion.ts` (comment retire), `src/attractor/tests/graph.test.ts` (one added case).
- **Surfaces crossed:** validator-internal only.
  - **CLI:** unaffected — no command, flag, or help text changes.
  - **Pipeline engine (run path):** unaffected — `variableExpansionTransform` already iterated `STRING_ATTRS`; this design does not touch it.
  - **Pipeline engine (validate path):** widens diagnostics to cover `$var` references inside `cwd=`. New warnings can surface for pipelines that already had typos; that is the intended improvement.
  - **Agents:** unaffected — no agent rubric or pipeline node sees a contract change.
  - **Pipeline schema / `.dot` syntax:** unaffected — `cwd=` was already a recognized attribute; this design only changes how the validator reads it.
  - **Public exports:** `STRING_ATTRS` was already exported from `variable-expansion.ts` (line 139); no external importer exists today, and `variable_coverage` / `checkOrphanOutput` are not exported.
  - **Build:** unaffected — no `tsconfig` glob, `tsup` entry, or bundling concern is touched.
- **Breaking change:** no. Semantics widen — more references are now caught — and nothing narrows. No previously valid pipeline becomes invalid; the only new diagnostics are for typos that were always wrong but went unreported.
- **Spec / docs ripple checklist:**
  - [ ] No ADR update required — no architectural decision is changed; ADR-0004 (source + CONTEXT.md as truth) and ADR-0007/0008 (project-local `.ralph/` pipelines) remain accurate.
  - [ ] No README update required — `README.md:94-107` already documents `cwd=` as a `$var`-bearing attribute; the validator now matches that documentation instead of trailing it.
  - [ ] No CONTEXT.md update required — `STRING_ATTRS` is implementation vocabulary, not domain language.
- **Test ripple checklist:**
  - [ ] `src/attractor/tests/graph.test.ts` — add one `cwd=` case to the `variable_coverage` suite (existing suite opens at line 544, closes at line 799). No existing test changes shape; the new case asserts a warning that previous code did not emit.

## 7. Trade-offs

### 7.1 Iteration over named-property access

Reading the field as `(node as Record<string, unknown>)[attr]` requires a cast because `Node` is a typed structure. Alternative: keep the named-property version and switch to a five-element literal per site that includes `cwd`.

**Chose iteration because:** the literal-list approach was the original mistake. It makes the validator's view drift from the runtime's view because the literal lives at two sites and the runtime constant lives at one. Iterating over the imported constant collapses the three-way drift into a single source of truth, which is the structural fix the illumination called for. The cast is a small, contained cost; the runtime already uses the same pattern at `src/attractor/transforms/variable-expansion.ts:146`.

### 7.2 Existing pipelines may now emit new warnings

A pipeline that previously validated cleanly because its `cwd=` typo was invisible will now surface a `variable_coverage` warning.

**Accepted because:** that is the entire point. The warnings are accurate — the typos were always wrong. Surfacing them at validate time is strictly cheaper than discovering them at run time. No author who currently relies on the silence is doing something the runtime supports; their pipeline already failed at run, just later.

### 7.3 Portability heuristic stays narrow

The portability-heuristic scan at `src/attractor/core/graph.ts:333` still reads only `[prompt, toolCommand]` and is left untouched.

**Accepted because:** that scan looks for hardcoded path substrings (`meditations/`, `docs/superpowers/`) inside command-shaped fields, which is a different concern from `$var` reference scanning. Widening it would require a different design (which other attributes should warn on hardcoded paths? probably none, since `cwd=` is *expected* to contain paths). Out of scope for this design; flagged separately if it ever becomes an issue.

## 8. Constraints

- The two validator sites and the test addition land in a single commit so the diff tells a single story.
- `npx tsc --noEmit` must pass after the change. The cast-and-index pattern is already established in `variable-expansion.ts`, so no new type-checker friction is expected.
- `npx vitest run` must pass with the new test case included. The pre-existing 188-case `variable_coverage` suite in `src/attractor/tests/graph.test.ts` continues to pass.
- The exported `STRING_ATTRS` constant remains a single five-element list. No second export, no shape change, no rename. Importers — including any future ones — read the same array shape.
- `pipeline run` behavior is unchanged. Any deviation in run-path output (success or failure) on existing pipelines indicates an unexpected coupling and must be investigated before merge.

## 9. Open questions

None. The verifier's three rubric criteria pass; the upstream sizing is unambiguously S; the chat refinements lock scope to the four edits in §2 and frame the win as `validate`/`run` signal-time consistency. The reviewer loop may surface nits on test placement or wording, but no design-level question is open at draft time.

## 10. Verification approach

### 10.1 Static checks

Run after the change, in order:

- `npx tsc --noEmit` — expected: clean. The new `STRING_ATTRS` import in `graph.ts` resolves to the existing export at `variable-expansion.ts:139`; the index-by-string pattern is already type-checked in the runtime use site.
- Repo-wide grep for the literal `["prompt", "toolCommand", "label", "scriptArgs"]` shape (the four-element form) inside `src/attractor/core/graph.ts` — expected: zero hits. Confirms both hardcoded copies are gone.
- Positive-existence grep for `STRING_ATTRS` inside `src/attractor/core/graph.ts` — expected: at least one hit on the import line, plus one hit per validator site that now iterates the constant. Guards against the failure mode where the hardcoded arrays are deleted but the replacement iteration is forgotten.
- Repo-wide grep for `Keep in sync` inside `src/attractor/transforms/variable-expansion.ts` — expected: zero hits. Confirms the now-stale comment at lines 135-136 is retired.

### 10.2 Tests

- `npx vitest run src/attractor/tests/graph.test.ts` — full file passes, including the new `cwd=` case in the `variable_coverage` suite.
- `npx vitest run` — entire suite passes. No other test exercises the field-list literals; behavioral coverage is contained to the targeted suite.

### 10.3 Smoke

- Author a one-node tool-type pipeline whose `cwd=` references an undeclared `$typoname`. Run `ralph pipeline validate` against it: expected output includes a `variable_coverage` warning naming `typoname` and the offending node. (Before this change, the same pipeline validated clean.)
- Re-run `ralph pipeline run` against the same pipeline: expected behavior unchanged from today — the runtime still surfaces the missing variable, with the same error class and message it produced before this design.
- `npm run build` — `tsup` produces the same `dist/` shape as before. No new entry, no removed entry.

## 11. Summary

Two duplicated four-element arrays in `src/attractor/core/graph.ts` (at lines 260-265 and 647-648) are replaced by iteration over the already-exported `STRING_ATTRS` constant from `src/attractor/transforms/variable-expansion.ts:137`. The keep-in-sync comment at `variable-expansion.ts:135-136` is retired because nothing is left to keep in sync. One regression test pins the `cwd=` case in the existing `variable_coverage` suite at `src/attractor/tests/graph.test.ts` (opens at 544, closes at 799). The user-visible win is signal-time consistency: `pipeline validate` now catches the same `$var` typos inside `cwd=` that `pipeline run` already errors on, so authors learn about typos pre-flight rather than mid-run. No runtime semantics change; no public contract breaks; no schema or agent or CLI surface is touched. Net code direction is reduction — two hardcoded copies disappear, one shared import takes their place.
