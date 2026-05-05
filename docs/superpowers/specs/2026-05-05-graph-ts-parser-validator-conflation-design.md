# Design: Extract `validateGraph` + check rules into `graph-validator.ts`

**Date:** 2026-05-05
**Status:** draft (pending review)
**Originating illumination:** `.ralph/meditations/illuminations/2026-05-05T1028-graph-ts-parser-validator-conflation.md`

## 1. Motivation

`src/attractor/core/graph.ts` is 1187 lines and holds two unrelated jobs sharing a file because they share types:

1. **Parser.** `parseDot(src: string): Graph` at `src/attractor/core/graph.ts:26` and the supporting helper `resolveHandlerType(node: Node): string` at `src/attractor/core/graph.ts:50`. Pure `string → Graph` translation backed by `@ts-graphviz/ast`.

2. **Validator.** `validateGraph(graph: Graph, dotDir?: string): Diagnostic[]` at `src/attractor/core/graph.ts:123` orchestrates 11 private `check*` rules co-located in the same file:

    - `checkOrphanOutput` at `src/attractor/core/graph.ts:602`
    - `checkOutputsSchemaShape` at `src/attractor/core/graph.ts:696`
    - `checkInputTypeMismatch` at `src/attractor/core/graph.ts:719`
    - `checkRequiredCallerVars` at `src/attractor/core/graph.ts:775`
    - `checkMissingInputProducer` at `src/attractor/core/graph.ts:872`
    - `checkAgentOutputsConflict` at `src/attractor/core/graph.ts:943`
    - `checkAgentMissingOutputs` at `src/attractor/core/graph.ts:993`
    - `checkLoopRequiresDoneField` at `src/attractor/core/graph.ts:1028`
    - `checkInteractiveWithOutputs` at `src/attractor/core/graph.ts:1057`
    - `checkInteractiveWithLoop` at `src/attractor/core/graph.ts:1076`
    - `checkGateHandlers` at `src/attractor/core/graph.ts:1109`

    The validator pulls in `flow-analyzer` (`src/attractor/core/graph.ts:13`), `conditions` (`src/attractor/core/graph.ts:14`), `agent-loader` (`src/attractor/core/graph.ts:11`), and `gate-registry` (`src/attractor/core/graph.ts:15`) — none of which the parser uses. The validator is the actual centre of gravity in the file; the file's name advertises a parser.

The locality cost is real: reading "what does rule X check" requires scrolling past 600+ lines of parser internals. Adding a 12th rule means another function in an already-1187-line file. The 11 helpers all live behind `validateGraph` (no external imports — verified by grep) so the seam is clean.

Recent commits show momentum toward single-purpose modules: `c8370da` split `AgentHandler`, `4b67e07` extracted `assembleAgentPrompt`, `1fa6811` deleted the parallel/conditional handler files. Extracting `validateGraph` fits that trajectory.

**Caveat preserved from the verifier:** the illumination's rhetorical anchor ("the sibling janitor illumination `2026-05-01T0344-janitor-pipeline-run-monolith.md` was acted on") is false — that illumination remains alive and `pipelineRunCommand` is still monolithic at `src/cli/commands/pipeline.ts`. The precedent claim is wrong; the structural argument for extracting `validateGraph` stands on its own.

This is plumbing-under-the-floor: the user-visible surface — CLI, MCP, agents, pipelines, `.ralph/` layout, frontmatter shapes, public exports — does not change.

## 2. Decision Summary

1. **Create `src/attractor/core/graph-validator.ts`.** Owns `validateGraph` + all 11 `check*` rules + their `flow-analyzer` / `conditions` / `agent-loader` / `gate-registry` calls. One file, not a `checks/` directory of per-rule files (see §7.1).

2. **Move, don't refactor.** Each `check*` body, the orchestration in `validateGraph` (`src/attractor/core/graph.ts:123-601`), and the validator-only helpers it captures move verbatim into `graph-validator.ts`. Diagnostic strings and rule semantics stay byte-identical.

3. **Re-export `validateOrRaise` from `graph-validator.ts`.** `validateOrRaise` at `src/attractor/core/graph.ts:1181` belongs with the validator — it is a thin wrapper around `validateGraph`.

4. **`graph.ts` keeps the parser surface.** After the move, `graph.ts` retains:
    - `parseDot` (line 26)
    - `resolveHandlerType` (line 50)
    - Top-level constants (`KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE`)
    - Any traversal helpers that survive in the parser slice

5. **Public-contract preservation.** External callers import `parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise`, and `Diagnostic` (the last from `src/attractor/types.ts:93-100`). The two consumers split as follows:

    - `parseDot`, `resolveHandlerType` → `graph.ts` (unchanged path).
    - `validateGraph`, `validateOrRaise` → `graph-validator.ts` (new path).
    - `Diagnostic` → `src/attractor/types.ts` (unchanged path).

    Update import paths at the call sites. No re-export shim from `graph.ts` (see §7.2 for why the brief mentioned one).

6. **Update CLI + 30+ test imports.** `src/cli/commands/pipeline.ts:6` swaps `import { parseDot, validateGraph, validateOrRaise } from "../../attractor/core/graph.js"` to two-line form pulling `validateGraph` + `validateOrRaise` from `graph-validator.js`. The 16 `pipeline-*-folder.test.ts` files under `src/cli/tests/` and the 15+ `graph*-validator*.test.ts` / `graph-*.test.ts` files under `src/attractor/tests/` get the same split.

7. **Add ADR-000N documenting the parser/validator split.** ADR-0004 (source-as-truth) endorses internal restructuring; ADR-0001 set precedent with `agent-loader.ts` as a single-purpose module. A new ADR records this split as the parser/validator parallel.

Out of scope:

- **Per-rule files under `src/attractor/core/checks/`.** Considered and rejected — see §7.1. One module, eleven private functions, mirrors the existing nine-handler pattern in `src/attractor/handlers/`.
- **Rule-logic changes.** No new rule, no rule-message edit, no rule-severity shift. Move-only.
- **Refactoring `flow-analyzer`, `conditions`, `agent-loader`, `gate-registry`.** They stay where they are — `graph-validator.ts` imports them at their existing paths.
- **Touching `pipeline.ts` monolith.** Separate illumination (`2026-05-01T0344-janitor-pipeline-run-monolith.md`); unblocked by this work.
- **Diagnostic-source-line plumbing changes.** The `sourceLine` carried on `Node` (per ADR-0006) and the `Diagnostic.line/col/source` shape at `src/attractor/types.ts:93-100` keep their wiring; rules continue to read from `node.sourceLine` and emit through the same shape.

## 3. Architecture

### 3.1 Current shape

```
src/attractor/core/graph.ts   (1187 lines)
  ├── imports
  │     ├── ../../cli/lib/agent-loader.js                     (line 11)  ← validator-only
  │     ├── ./flow-analyzer.js                                (line 13)  ← validator-only
  │     ├── ./conditions.js                                   (line 14)  ← validator-only
  │     ├── ../../cli/lib/gate-registry.js                    (line 15)  ← validator-only
  │     └── parser-only imports (@ts-graphviz/ast, dot-common, types)
  ├── KNOWN_TYPES / UNIMPLEMENTED_TYPES / SHAPE_TO_TYPE       (top-level constants)
  ├── parseDot                                                (line 26, exported) ← parser
  ├── resolveHandlerType                                      (line 50, exported) ← parser/shared
  ├── validateGraph                                           (line 123, exported) ← validator orchestrator
  │     └── ~480 lines of orchestration + inline helpers
  ├── checkOrphanOutput                                       (line 602)  ← validator rule
  ├── checkOutputsSchemaShape                                 (line 696)
  ├── checkInputTypeMismatch                                  (line 719)
  ├── checkRequiredCallerVars                                 (line 775)
  ├── checkMissingInputProducer                               (line 872)
  ├── checkAgentOutputsConflict                               (line 943)
  ├── checkAgentMissingOutputs                                (line 993)
  ├── checkLoopRequiresDoneField                              (line 1028)
  ├── checkInteractiveWithOutputs                             (line 1057)
  ├── checkInteractiveWithLoop                                (line 1076)
  ├── checkGateHandlers                                       (line 1109)
  └── validateOrRaise                                         (line 1181, exported) ← validator wrapper

src/cli/commands/pipeline.ts:6
  └── import { parseDot, validateGraph, validateOrRaise } from "../../attractor/core/graph.js";

src/attractor/tests/ (15+ files)
  └── import { parseDot, validateGraph } from "../core/graph.js";

src/cli/tests/pipeline-*-folder.test.ts (16 files)
  └── import { parseDot, validateGraph } from "../../attractor/core/graph.js";
```

### 3.2 Target shape

```
src/attractor/core/graph.ts   (~600 lines, parser-only)
  ├── imports
  │     ├── parser-only imports (@ts-graphviz/ast, dot-common, types)
  │     └── (agent-loader / flow-analyzer / conditions / gate-registry imports gone)
  ├── KNOWN_TYPES / UNIMPLEMENTED_TYPES / SHAPE_TO_TYPE       (top-level constants, exported for graph-validator)
  ├── parseDot                                                (line ~26, exported)
  └── resolveHandlerType                                      (line ~50, exported)

src/attractor/core/graph-validator.ts   (new, ~600 lines)
  ├── imports
  │     ├── ./graph.js                  (KNOWN_TYPES, UNIMPLEMENTED_TYPES, resolveHandlerType, etc.)
  │     ├── ./flow-analyzer.js
  │     ├── ./conditions.js
  │     ├── ../../cli/lib/agent-loader.js
  │     ├── ../../cli/lib/gate-registry.js
  │     └── ../types.js                 (Graph, Node, Diagnostic)
  ├── validateGraph                     (exported) ← orchestrator
  ├── checkOrphanOutput                 (private)
  ├── checkOutputsSchemaShape           (private)
  ├── checkInputTypeMismatch            (private)
  ├── checkRequiredCallerVars           (private)
  ├── checkMissingInputProducer         (private)
  ├── checkAgentOutputsConflict         (private)
  ├── checkAgentMissingOutputs          (private)
  ├── checkLoopRequiresDoneField        (private)
  ├── checkInteractiveWithOutputs       (private)
  ├── checkInteractiveWithLoop          (private)
  ├── checkGateHandlers                 (private)
  └── validateOrRaise                   (exported) ← thin wrapper around validateGraph

src/cli/commands/pipeline.ts:6
  ├── import { parseDot } from "../../attractor/core/graph.js";
  └── import { validateGraph, validateOrRaise } from "../../attractor/core/graph-validator.js";

src/attractor/tests/ (15+ files, updated imports)
  ├── import { parseDot } from "../core/graph.js";
  └── import { validateGraph } from "../core/graph-validator.js";

src/cli/tests/pipeline-*-folder.test.ts (16 files, updated imports)
  ├── import { parseDot } from "../../attractor/core/graph.js";
  └── import { validateGraph } from "../../attractor/core/graph-validator.js";
```

The line count target for `graph-validator.ts` is approximate — the file inherits the validator's 480-line orchestrator + 11 `check*` bodies + their captured helpers. `graph.ts` shrinks correspondingly to ~600 lines, holding parser, types-shared constants, and `resolveHandlerType`.

### 3.3 Where the constants live

`KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, and `SHAPE_TO_TYPE` (currently top-level in `graph.ts`) are shared between `parseDot`/`resolveHandlerType` (parser side, e.g. shape inference) and `validateGraph` (validator side, e.g. type-recognition diagnostic). They stay in `graph.ts` and become exported so `graph-validator.ts` can import them. This avoids duplication and keeps the canonical source for "what types does the engine recognize" in one place.

If a future refactor decides the constants belong in a third file (e.g. `node-types.ts`), that is a follow-up — not in scope here.

### 3.4 Helpers captured by `validateGraph`

`validateGraph` currently owns three nested closure-style helpers (`hasDefault`, `reachable`, `findQualifiedProducer`) bundled into a `GraphTraversal` factory by the in-flight design `2026-05-04-janitor-graph-validator-bloat-design.md`. Two cases:

- **If the bloat-design ships first:** `graph-validator.ts` imports `createGraphTraversal` from wherever the bloat-design landed it (likely a module-level export in `graph.ts`); the move stays mechanical.
- **If this design ships first:** the helpers travel with `validateGraph` into `graph-validator.ts` as the bloat-design originally found them. The bloat-design's later landing then targets `graph-validator.ts` instead of `graph.ts`. The two designs commute.

Concretely, this means the move-only nature of this design is robust to either ordering. No coordination required beyond updating the bloat-design's target file path if that work lands later.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/attractor/core/graph.ts` | Delete `validateGraph` (lines 123-601), all 11 `check*` functions (lines 602-1180), and `validateOrRaise` (line 1181-end). Delete the four validator-only imports at lines 11, 13, 14, 15. Mark `KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE` (top-level constants) as `export` if not already. File shrinks to ~600 lines, parser-only. |
| `src/attractor/core/graph-validator.ts` | **New file.** Holds `validateGraph`, all 11 `check*` rules, and `validateOrRaise` — moved verbatim from `graph.ts`. Imports `flow-analyzer`, `conditions`, `agent-loader`, `gate-registry`, the constants from `./graph.js`, and `Graph`/`Node`/`Diagnostic` from `../types.js`. Exports `validateGraph` and `validateOrRaise`. |
| `src/cli/commands/pipeline.ts` | Update line 6 to split the import: `parseDot` from `graph.js`, `validateGraph`/`validateOrRaise` from `graph-validator.js`. The four call sites at lines 163, 177, 215, 217, 572, 717, 732 keep their function-call shapes — only the import sources move. |
| `src/attractor/tests/*.test.ts` (~15 files) | Update import paths in every file that pulls `validateGraph` from `../core/graph.js` to pull from `../core/graph-validator.js`. Files that import only `parseDot` need no change. Mechanical sed-style edit. |
| `src/cli/tests/pipeline-*-folder.test.ts` (16 files) | Same import-path split: `parseDot` keeps its source, `validateGraph` moves to `graph-validator.js`. |
| `docs/adr/000N-parser-validator-split.md` | **New ADR.** Records the split, references ADR-0001 (single-purpose modules) and ADR-0004 (source-as-truth) as predecessors, captions the parallel between `agent-loader.ts` and `graph-validator.ts`. Short — under one page. |

No source-code logic changes. No rule edits. No diagnostic-message edits. No public-export signature changes.

## 5. Data flow

The parser → validator pipeline is unchanged at every layer:

- `pipeline.ts` calls `parseDot(src)` to get a `Graph`, then calls `validateGraph(graph, dotDir)` to get `Diagnostic[]`.
- The `Graph` shape is unchanged — all node attributes, edge shapes, and `sourceLine` annotations stay identical.
- The `Diagnostic` shape (file/line/col/severity/code/message at `src/attractor/types.ts:93-100`) is unchanged — every rule emits through the same struct.
- Rule semantics are byte-identical. Each rule sees the same `Graph` it saw before, computes the same flow-analyzer / agent-loader / gate-registry outputs, and emits the same diagnostic messages with the same `code` and `severity`.

The only data-flow change is the import edge: `pipeline.ts` and 30+ test files now resolve `validateGraph` through `graph-validator.ts` instead of `graph.ts`. No bundler change required — `tsup` resolves both files identically.

## 6. Blast radius / impact surface

Sourced from the verifier's `Blast radius:` paragraph and the explainer's `## Blast radius` block.

- **Size:** M
- **Files touched:** ~35 — 1 new module (`graph-validator.ts`), 1 modified parser module (`graph.ts`, validator code deleted), 1 CLI consumer (`pipeline.ts`, import split), 16 folder-form smoke tests in `src/cli/tests/`, 15+ attractor validator tests in `src/attractor/tests/`, 1 new ADR.
- **Surfaces crossed:** validator core + parser core + CLI consumer + test suite + docs.
  - **CLI:** unaffected — no command, flag, or help-text change.
  - **MCP / `illumination-server`:** unaffected — no surface touched.
  - **Pipeline engine (run path):** unaffected — only the validate path imports `validateGraph`; engine's `runPipeline` does not.
  - **Pipeline engine (validate path):** behaviorally identical. Same diagnostics, same byte-identical messages. Internal import-resolution change only.
  - **Agents:** unaffected — no agent rubric, prompt, or contract sees a change.
  - **Pipeline schema / `.dot` syntax:** unaffected.
  - **`.ralph/` layout, frontmatter shapes:** unaffected.
  - **Public exports:** all 11 `check*` helpers are private (zero external references — confirmed by repo-wide grep). Stable contract surface is `parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise`, and the `Diagnostic` type at `src/attractor/types.ts:93-100`. All five keep their signatures verbatim. The two validator-side exports (`validateGraph`, `validateOrRaise`) move file but keep their package-relative public path under `src/attractor/core/`.
- **Breaking change:** **no.** Internal-only refactor; no public flag / schema / pipeline contract moves. The import-path change is a same-package move; downstream consumers update at the same time as the move (no external npm consumer of `src/attractor/core/`).
- **Spec / docs ripple checklist:**
  - [ ] No CONTEXT.md update required — repo-wide grep finds no `graph.ts` mention in `CONTEXT.md` (verifier confirmed).
  - [ ] No README update required — same.
  - [ ] One new ADR required: `docs/adr/000N-parser-validator-split.md`. References ADR-0001 (single-purpose modules) and ADR-0004 (source-as-truth) as the precedent that endorses the split.
  - [ ] If the in-flight bloat-design (`2026-05-04-janitor-graph-validator-bloat-design.md`) lands first, its line citations stay correct. If this design lands first, that design's `graph.ts` line citations need re-pointing to `graph-validator.ts`. Coordinate at merge time; the two are mechanically commuting.
- **Test ripple checklist:**
  - [ ] `src/attractor/tests/graph.test.ts` — update imports if it pulls `validateGraph`. The 17 `variable_coverage` cases continue to exercise `validateGraph` end-to-end.
  - [ ] `src/attractor/tests/graph-validator-outputs.test.ts`, `graph-validator-inputs.test.ts`, `graph-validator-loop-done.test.ts`, `graph-validator-auto-inputs-fixture.test.ts` — update imports.
  - [ ] `src/attractor/tests/graph-required-caller-vars.test.ts`, `graph-outputs-conflict.test.ts`, `graph-outputs-derives-produces.test.ts`, `graph-outputs-schema-invalid.test.ts`, `graph-orphan-output.test.ts`, `graph-produces-redundant-broad.test.ts` — update imports.
  - [ ] `src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts`, `graph-interactive-with-outputs-forbidden.test.ts`, `graph-gate-validation.test.ts`, `graph-inputs-flow.test.ts`, `graph-portability.test.ts`, `graph-ast.test.ts` — update imports if they pull `validateGraph`; those that test only `parseDot` need no change.
  - [ ] 16 `pipeline-*-folder.test.ts` under `src/cli/tests/` — same import split. None test rule semantics; they assert zero error-level diagnostics on bundled pipelines.
  - [ ] No new test file required. A `graph-validator.test.ts` shell could be added if the move surfaces a missing seam, but the rule semantics are already covered by the per-rule tests above.

## 7. Trade-offs

### 7.1 One module vs `checks/<rule>.ts` per file

The illumination raised both options: a single `graph-validator.ts`, or one file per rule under `src/attractor/core/checks/`. This design picks **one module**.

**Arguments for the directory:**
- Each rule becomes filename-discoverable.
- Each rule could grow private helpers without polluting a sibling.
- Adding a rule = adding a file, never editing a long index.

**Arguments against (chosen):**
- The 11 rules average ~50 lines each; per-file overhead (imports + boilerplate) becomes noisy relative to the body.
- The orchestrator (`validateGraph` itself, currently 480 lines spanning `src/attractor/core/graph.ts:123-601`) needs to know about every rule to dispatch them. A directory layout still requires an index file that lists each rule — the discoverability claim only partially holds.
- The existing `src/attractor/handlers/` precedent is the opposite: nine handlers in nine sibling files, no `handlers/<type>/` directory. The closest reference architecture in this repo is one-file-per-thing at the next level up.
- Adding a rule today is a one-function append; the noise cost is one extra `m.set`-equivalent in the orchestrator and one new function in the file. Per-file directory layout would make rule-additions diff-noisier (new file + index update + import) without changing the test-surface story.

The two-file-instead-of-twelve-file split keeps the per-file file count low while honoring the parser-vs-validator separation that motivates the work. If a future rule grows to 200+ lines or pulls in several heavy private helpers, that rule alone can move to its own file under `checks/` without forcing the rest. Directory-layout adoption costs nothing to defer.

### 7.2 No re-export shim from `graph.ts`

A re-export of `validateGraph`/`validateOrRaise` from `graph.ts` would let existing consumer code keep its import paths intact, deferring the import-path split forever. Reasons against:

- The codebase has 30+ direct consumers; updating their imports is mechanical and one-shot. A shim would advertise a misleading API surface (`graph.ts` "exports" a validator) — exactly the conflation this design removes.
- Re-exports also confuse type imports vs value imports for tools like `tsc` and editor go-to-definition; clean separation makes `graph.ts` clearly parser-only.
- ADR-0004 (source-as-truth) reads against shims that keep stale module names alive; the import-path move is the canonical signal that the validator no longer lives in `graph.ts`.

If a downstream consumer absolutely must keep the old import path (none exists), a one-line `export { validateGraph } from "./graph-validator.js";` can be added as a follow-up. Not in this design.

### 7.3 Move verbatim vs refactor while moving

Tempting refinements (consolidate orchestration, factor common rule scaffolding, drop dead branches) are deferred. Reasons:

- The diff is reviewable as a pure move — every byte of logic survives. A reviewer can compare the new `graph-validator.ts` against the deleted slice of `graph.ts` line-by-line.
- Refactoring while moving entangles two stories; if a regression appears, bisecting "was it the move or the refactor" costs time.
- The bloat-design (`2026-05-04-janitor-graph-validator-bloat-design.md`) is the right place for the rule-shape refinements; this design unblocks that work by giving it a focused file to operate on.

### 7.4 No new ADR for "modules under `src/attractor/core/`"

The new ADR is narrowly about "validator extracted from parser" — not a general policy. ADR-0001 already endorses single-purpose modules; this ADR records the specific instance and updates the precedent set. Authoring it after the move keeps the ADR concrete (file paths, line counts, predecessor refs) rather than aspirational.

### 7.5 Constants stay in `graph.ts`, not duplicated

`KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE` are touched by both parser (shape inference) and validator (type recognition diagnostic). Duplicating them across `graph.ts` and `graph-validator.ts` would let the two drift; importing from one canonical location keeps drift impossible. `graph.ts` is the natural owner — `parseDot` reads them first.

### 7.6 Don't move `resolveHandlerType` to the validator

`resolveHandlerType` looks like a validator helper but is also called by `engine.ts` (the run path) and is invoked at `pipeline.ts:215, 572` outside the validate path. Moving it to `graph-validator.ts` would force the engine to import a "validator" file. Keep it in `graph.ts` as a parser/type-resolution helper; the validator imports it.

## 8. Constraints

- All edits land in a single commit so the diff tells a single story (1 new file, 1 deleted slice from `graph.ts`, 1 import update in `pipeline.ts`, ~30 import updates in tests, 1 new ADR).
- `npx tsc --noEmit` must pass after the change. The move preserves all signatures; the only typecheck shifts are the import-path updates.
- `npx vitest run` must pass with no edits to rule semantics or diagnostic strings. The 17 `variable_coverage` cases in `src/attractor/tests/graph.test.ts`, the 15+ per-rule validator tests in `src/attractor/tests/`, and the 16 `pipeline-*-folder.test.ts` files all pass unchanged after import-path updates.
- Diagnostic strings emitted by every `check*` rule stay byte-identical pre- and post-move. Any wording change indicates accidental coupling and must be reverted before merge.
- `parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise` signatures stay verbatim. The `Diagnostic` shape at `src/attractor/types.ts:93-100` stays verbatim.
- `pipeline.jsonl` byte-equivalence (modulo timestamps + nondeterministic IDs) for any pre-change valid graph — the validate path produces the same `Diagnostic[]`, the engine produces the same `nodeKind` records.

## 9. Open questions

None at design-doc time. All three rubric criteria pass per the verifier's evidence. The reviewer loop may surface nits on:

- One-module vs `checks/` directory layout (covered in §7.1; revisit only if a rule outgrows the 50-line average).
- ADR placement / numbering — to be filled in at write time based on existing ADR numbering in `docs/adr/`.
- Whether the import-split in tests should be done by codemod or by hand — operationally a question, not a design question.
- Coordination with the in-flight `2026-05-04-janitor-graph-validator-bloat-design.md`. The two designs commute (see §3.4); merge order decides which set of line citations gets re-pointed.
- Whether `KNOWN_TYPES` / `UNIMPLEMENTED_TYPES` / `SHAPE_TO_TYPE` belong in a third file (`node-types.ts`). Out of scope; flagged for transparency.

The illumination's false-precedent claim about the janitor monolith illumination is preserved as a caveat (§1) rather than corrected silently — keeping the audit trail honest.

## 10. Verification approach

### 10.1 Static checks

Run after the change, in order:

- `npx tsc --noEmit` — clean. The move preserves signatures; only import-path resolution shifts.
- Repo-wide grep for `from ".*core/graph"` (literal substring, no `-validator`) — expected: only parser callers (`parseDot`, `resolveHandlerType`) hit this path. Validator callers should grep through `graph-validator`.
- Repo-wide grep for `validateGraph\|validateOrRaise` — expected: imports resolve through `graph-validator.js` everywhere except inside `graph-validator.ts` itself (the definition site).
- Repo-wide grep for `check[A-Z]\w*\(` — expected: zero hits outside `graph-validator.ts` (all 11 helpers are private to the validator).
- Positive-existence grep for `export function validateGraph` in `src/attractor/core/graph-validator.ts` — expected: 1 hit.
- Repo-wide grep for `export function validateGraph` — expected: exactly 1 hit (in `graph-validator.ts`).

### 10.2 Tests

- `npx vitest run src/attractor/tests/` — full validator suite passes; per-rule files (`graph-validator-outputs.test.ts` etc.) and `graph.test.ts` (17 `variable_coverage` cases) all green after import-path updates.
- `npx vitest run src/cli/tests/pipeline-*-folder.test.ts` — all 16 folder-form smoke tests pass; bundled pipelines validate to zero error-level diagnostics.
- `npx vitest run` — entire suite passes.

### 10.3 Smoke

- `ralph pipeline validate <bundled-pipeline>` against each bundled per-folder pipeline under `src/cli/pipelines/` — expected: identical diagnostic output before and after, byte-for-byte.
- `ralph pipeline run <bundled-pipeline>` against a known-good pipeline (e.g. `implement`) — expected: identical exit code and `pipeline.jsonl` content (modulo timestamps + nondeterministic IDs).
- `npm run build` — `tsup` produces the same `dist/` shape plus one new emitted file (`dist/.../core/graph-validator.js`). No new bin entries, no removed bin entries.

### 10.4 Negative cases

- Hand-construct a deliberately-invalid `.dot` (e.g. an orphan output, a missing-input-producer case) and run `ralph pipeline validate` — expected: identical `Diagnostic` array (same `code`, `message`, `severity`, `line`/`col`/`source`) before and after the move. This is the byte-identical-diagnostic guarantee §8 demands.
- Author a `.dot` exercising every one of the 11 rules (existing fixtures in `src/attractor/tests/fixtures/` cover this) and diff the validator output pre- vs post-move — expected: zero difference outside the import-path edits in test files.

## 11. Summary

`src/attractor/core/graph.ts` (1187 lines) is split: parser stays in `graph.ts`, validator moves to a new `src/attractor/core/graph-validator.ts`. `parseDot` (line 26) and `resolveHandlerType` (line 50) keep their home; `validateGraph` (line 123) and all 11 private `check*` rules (`checkOrphanOutput`:602, `checkOutputsSchemaShape`:696, `checkInputTypeMismatch`:719, `checkRequiredCallerVars`:775, `checkMissingInputProducer`:872, `checkAgentOutputsConflict`:943, `checkAgentMissingOutputs`:993, `checkLoopRequiresDoneField`:1028, `checkInteractiveWithOutputs`:1057, `checkInteractiveWithLoop`:1076, `checkGateHandlers`:1109) plus `validateOrRaise` (line 1181) move verbatim. The four validator-only imports (`agent-loader`, `flow-analyzer`, `conditions`, `gate-registry`) follow the validator and disappear from `graph.ts`. `KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE` stay in `graph.ts` as the canonical type-recognition source. `src/cli/commands/pipeline.ts:6` splits its import; ~30 test files do the same. A new ADR documents the parser/validator split as a concrete instance of ADR-0001 (single-purpose modules) and ADR-0004 (source-as-truth). All public exports keep their signatures; all rule logic and diagnostic messages stay byte-identical. Net effect: a 1187-line file becomes two ~600-line files with one job each, and "where do I add a new validation rule?" gets a one-word answer.
