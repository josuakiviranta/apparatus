# Extract `validateGraph` + check rules into `graph-validator.ts` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src/attractor/core/graph.ts` (1187 lines) into a parser-only `graph.ts` and a new `src/attractor/core/graph-validator.ts` that owns `validateGraph` + 11 private `check*` rules + `validateOrRaise`, with byte-identical diagnostic output.

**Architecture:** Move-only refactor. `graph-validator.ts` imports the four validator-only deps (`agent-loader`, `flow-analyzer`, `conditions`, `gate-registry`) plus shared constants (`KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE`) re-exported from `graph.ts`. Public surface (`parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise`, `Diagnostic`) keeps signatures verbatim. Single import-path split at every call site (1 CLI consumer + ~30 test files). New ADR-0009 documents the parser/validator split.

**Tech Stack:** TypeScript, Node.js, `@ts-graphviz/ast`, `tsup` build, `vitest` test runner. ESM imports use `.js` extensions.

**Source-of-truth design:** `docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md`. Originating illumination: `meditations/illuminations/2026-05-05T1028-graph-ts-parser-validator-conflation.md`.

**Commit policy:** Design §8 demands a single final commit. This plan organizes work into four review chunks, each ending with a checkpoint commit. After Chunk 4 passes verification, squash the four checkpoint commits into one via `git rebase -i HEAD~4` so the final history matches the design constraint. The squash is its own step at the close of Chunk 4 — do **not** skip it.

---

## Chunk 1: Create `graph-validator.ts`, move validator code out of `graph.ts`

This is the structural move. After this chunk, `graph.ts` is parser-only and `graph-validator.ts` owns the validator. Every existing import path remains broken until Chunks 2 and 3 update consumers — `npx tsc --noEmit` at the end of Chunk 1 is expected to fail with import errors only at known consumer sites; that is the gate Chunk 2 closes.

**Files:**
- Create: `src/attractor/core/graph-validator.ts`
- Modify: `src/attractor/core/graph.ts`

### Step 1.1: Inventory the move surface

- [x] **Step 1.1.1: Capture the exact byte ranges that move**

Run, in the repo root:

```bash
grep -n '^export function\|^function check\|^export async function' src/attractor/core/graph.ts
```

Expected output (already verified, line numbers anchor the move):

```
26:export function parseDot(src: string): Graph {
50:export function resolveHandlerType(node: Node): string {
123:export function validateGraph(graph: Graph, dotDir?: string): Diagnostic[] {
602:function checkOrphanOutput(
696:function checkOutputsSchemaShape(
719:function checkInputTypeMismatch(
775:function checkRequiredCallerVars(
872:function checkMissingInputProducer(
943:function checkAgentOutputsConflict(
993:function checkAgentMissingOutputs(
1028:function checkLoopRequiresDoneField(
1057:function checkInteractiveWithOutputs(
1076:function checkInteractiveWithLoop(
1109:function checkGateHandlers(
1181:export function validateOrRaise(graph: Graph): void {
```

If the line numbers drift (recent commits to `graph.ts` after this plan was written), use the symbol names — never hard-coded line numbers — to anchor the edits. The move surface is the contiguous slice that begins at the top of `validateGraph` (line 123) and ends at the closing `}` of `validateOrRaise` plus the four validator-only imports at the top.

- [x] **Step 1.1.2: Capture the four validator-only imports that move**

Open `src/attractor/core/graph.ts` and confirm these import lines exist (line numbers approximate; match by source):

```ts
import { loadAgent } from "../../cli/lib/agent-loader.js";        // line 11
import type { AgentConfig } from "../../cli/lib/agent.js";        // line 12
import { computeVarsInScope, computeVarsInAnyScope } from "./flow-analyzer.js";  // line 13
import { parseConditionClauses } from "./conditions.js";          // line 14
import { resolveGate } from "../../cli/lib/gate-registry.js";     // line 15
```

These five lines (validator-only deps + the `AgentConfig` type that travels with `loadAgent`) move to `graph-validator.ts`. If `validateGraph` references additional helpers from later in `graph.ts` that the parser does not, identify them by `grep -n 'function ' src/attractor/core/graph.ts` and treat each as a candidate to move with the validator. Move policy: a helper that is called only inside `validateGraph` or any `check*` function moves; a helper called by `parseDot` or `resolveHandlerType` stays.

- [x] **Step 1.1.3: Verify no external code calls the 11 `check*` helpers**

Run:

```bash
grep -rn 'checkOrphanOutput\|checkOutputsSchemaShape\|checkInputTypeMismatch\|checkRequiredCallerVars\|checkMissingInputProducer\|checkAgentOutputsConflict\|checkAgentMissingOutputs\|checkLoopRequiresDoneField\|checkInteractiveWithOutputs\|checkInteractiveWithLoop\|checkGateHandlers' src/ --include='*.ts'
```

Expected: every hit is inside `src/attractor/core/graph.ts`. Zero hits in tests, in CLI code, or in handlers. This confirms the design's claim that all 11 are private. If any external hit appears, stop and surface to the user — the move plan would need to export that helper from `graph-validator.ts`.

### Step 1.2: Add the failing test that pins byte-identical diagnostics

The diagnostic-byte-equivalence guarantee is the single most important contract this refactor preserves. Pin it with a snapshot test before moving any code.

- [x] **Step 1.2.1: Write the failing snapshot test**

Create `src/attractor/tests/graph-validator-byte-identical.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseDot, validateGraph } from "../core/graph.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, "fixtures");

function collectDotFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectDotFiles(full));
    else if (entry.endsWith(".dot")) out.push(full);
  }
  return out;
}

describe("validateGraph byte-identical diagnostic snapshot", () => {
  const dotFiles = collectDotFiles(FIXTURES_DIR);
  expect(dotFiles.length).toBeGreaterThan(0);

  for (const dotPath of dotFiles) {
    it(`${dotPath.replace(FIXTURES_DIR, "fixtures")}`, () => {
      const src = readFileSync(dotPath, "utf-8");
      let graph;
      try {
        graph = parseDot(src);
      } catch {
        return; // unparseable fixtures are not validator inputs
      }
      const diagnostics = validateGraph(graph);
      expect(diagnostics).toMatchSnapshot();
    });
  }
});
```

If `src/attractor/tests/fixtures/` does not exist, fall back to a curated list of bundled `.dot` files. Run `find src/cli/pipelines -name '*.dot' | head` to find candidates and substitute the directory in `FIXTURES_DIR`.

- [x] **Step 1.2.2: Run the test to record the pre-move baseline**

Run:

```bash
npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts -u
```

Expected: tests pass and write snapshots into `src/attractor/tests/__snapshots__/graph-validator-byte-identical.test.ts.snap`. **Commit the snapshot file as part of this chunk** — it is the byte-equivalence oracle every later chunk re-runs without `-u`.

- [x] **Step 1.2.3: Verify the test re-runs green without `-u`**

```bash
npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts
```

Expected: PASS. If it fails, the fixture set is non-deterministic — investigate and stabilize before continuing.

### Step 1.3: Mark shared constants exported in `graph.ts`

`graph-validator.ts` imports `KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE` from `graph.ts`. Confirm they are exported.

- [x] **Step 1.3.1: Read the constant declarations**

Open `src/attractor/core/graph.ts` and grep for each constant:

```bash
grep -n 'KNOWN_TYPES\|UNIMPLEMENTED_TYPES\|SHAPE_TO_TYPE' src/attractor/core/graph.ts | head -10
```

For each declaration site (likely near the top of the file), confirm the line begins with `export const`. If any reads `const KNOWN_TYPES = ...` without `export`, edit it to `export const KNOWN_TYPES = ...`. Same for `UNIMPLEMENTED_TYPES` and `SHAPE_TO_TYPE`.

- [x] **Step 1.3.2: Run typecheck after constant export**

```bash
npx tsc --noEmit
```

Expected: PASS. Adding `export` to a previously-internal `const` is non-breaking.

### Step 1.4: Create `graph-validator.ts` with moved code

- [x] **Step 1.4.1: Read the entire validator slice from `graph.ts`**

Open `src/attractor/core/graph.ts` and read lines 123 through end-of-file (`validateGraph` start through `validateOrRaise` close). This is the byte slice that moves. Note any helpers nested inside `validateGraph` (closures, factories like `createGraphTraversal`, helpers like `hasDefault` / `reachable` / `findQualifiedProducer`) — they travel with `validateGraph`.

- [x] **Step 1.4.2: Write `src/attractor/core/graph-validator.ts`**

Create the new file with this skeleton, then paste the moved code into the marked region:

```ts
import { existsSync } from "fs";
import { resolve as resolvePath, extname, join } from "path";
import type { Graph, Node, Diagnostic } from "../types.js";
import { expandVariables, extractDefaults, UndefinedVariableError, STRING_ATTRS } from "../transforms/variable-expansion.js";
import { validateNode } from "./schemas.js";
import { toCamel, buildForwardAdj } from "./dot-common.js";
import { loadAgent } from "../../cli/lib/agent-loader.js";
import type { AgentConfig } from "../../cli/lib/agent.js";
import { computeVarsInScope, computeVarsInAnyScope } from "./flow-analyzer.js";
import { parseConditionClauses } from "./conditions.js";
import { resolveGate } from "../../cli/lib/gate-registry.js";
import { resolveInputDecl } from "../transforms/inputs-resolver.js";
import { SYSTEM_INJECTED_VARS } from "../handlers/agent-prep.js";
import { outputsToZod } from "../../cli/lib/outputs-to-zod.js";
import { KNOWN_TYPES, UNIMPLEMENTED_TYPES, SHAPE_TO_TYPE, resolveHandlerType } from "./graph.js";

// ─────────────────────────────────────────────────────────────────────────────
// MOVED VERBATIM FROM src/attractor/core/graph.ts (lines 123–end pre-move)
// Includes: validateGraph + 11 check* helpers + validateOrRaise + any private
// helpers captured only by the validator (e.g. SYSTEM_VARS, isQualifiedKey if
// used only by validator code).
// ─────────────────────────────────────────────────────────────────────────────

// PASTE HERE: validateGraph through validateOrRaise verbatim
```

Inspect each import in the skeleton against what `graph.ts` actually pulled in. Two import categories:

1. **Pure-validator imports** (the four design-§3.1 lines) — these belong in `graph-validator.ts` only.
2. **Shared imports** (e.g. `existsSync`, `resolvePath`, `validateNode`, `expandVariables`, `outputsToZod`, `resolveInputDecl`, `SYSTEM_INJECTED_VARS`, `toCamel`, `buildForwardAdj`) — these may be needed by both files. Keep them in `graph.ts` if `parseDot` uses them; copy them into `graph-validator.ts` if `validateGraph` uses them. If both use a symbol, both files import it independently from the original source — do NOT route imports through one another except for the shared constants.

If after the move any private helper (e.g. `isQualifiedKey` at `graph.ts:22`, `SYSTEM_VARS` at `graph.ts:20`) is referenced only by validator code, move it into `graph-validator.ts`. If both parser and validator use it, duplicate the declaration into `graph-validator.ts` so each file is self-contained, and add a comment in both: `// Mirrored in graph.ts / graph-validator.ts; keep in sync.` Justification: the design (§7.5) accepts duplication only for constants that are clearly shared and stable. Private helpers like `isQualifiedKey` are one-liners; duplication is cheaper than a third file. If the helper grows, that is a separate refactor.

- [x] **Step 1.4.3: Delete the moved code from `graph.ts`**

In `src/attractor/core/graph.ts`:

1. Delete `validateGraph` (line 123) through end-of-file (`validateOrRaise` closing brace).
2. Delete the four validator-only imports (`agent-loader`, `AgentConfig`, `flow-analyzer`, `conditions`, `gate-registry`).
3. Delete any private helpers above `validateGraph` that were used only by validator code (verify each by `grep -n` after the deletion — anything red-underlined by `tsc` after Chunk 2 imports update is the trigger to revisit).
4. Keep `parseDot`, `resolveHandlerType`, `KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE`, and any helpers `parseDot` calls.

After deletion, the file should be ~600 lines (design §3.2 target). Run `wc -l src/attractor/core/graph.ts` — expected: ~600.

- [x] **Step 1.4.4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: errors only at consumer sites that still import `validateGraph` / `validateOrRaise` from `./graph.js`. List them — they are the Chunk 2 + Chunk 3 work surface. Errors inside `graph.ts` or `graph-validator.ts` itself are bugs in the move; fix before proceeding.

A clean diagnostic looks like:

```
src/cli/commands/pipeline.ts:6:10 - error TS2305: Module '"../../attractor/core/graph.js"' has no exported member 'validateGraph'.
```

This is the expected gate. If `tsc` reports an error inside `graph-validator.ts` (e.g. "Cannot find name 'isQualifiedKey'"), a needed private helper was not moved — go back to Step 1.4.2 and add it.

- [x] **Step 1.4.5: Commit checkpoint**

```bash
git add src/attractor/core/graph.ts src/attractor/core/graph-validator.ts src/attractor/tests/graph-validator-byte-identical.test.ts src/attractor/tests/__snapshots__/graph-validator-byte-identical.test.ts.snap
git commit -m "refactor(attractor/core): extract validateGraph into graph-validator.ts

Move-only split: parser stays in graph.ts, validator moves to new
graph-validator.ts. All 11 check* rules + validateOrRaise travel with
the orchestrator. Diagnostic strings byte-identical (snapshot pinned
in graph-validator-byte-identical.test.ts).

Consumers still reference old import paths; Chunk 2 + Chunk 3 update them.

Refs: docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md"
```

## Verification targets

- Smokes: None (smokes still broken until Chunk 2+3 land — re-run after Chunk 3)
- Manual exercises: None
- Lint: `npx tsc --noEmit` — expected to fail only at consumer-import sites; failures inside `graph.ts` / `graph-validator.ts` are bugs
- Surfaces touched: validator core, parser core

---

## Chunk 2: Update CLI consumer imports

Two CLI files import the validator: `src/cli/commands/pipeline.ts` (the validate path) and any sibling that pulled `validateGraph` / `validateOrRaise`. Re-run the consumer survey at chunk start to be sure.

**Files:**
- Modify: `src/cli/commands/pipeline.ts`
- Modify (if hit): any other `src/cli/**/*.ts` file that imports `validateGraph` or `validateOrRaise`

### Step 2.1: Re-survey CLI consumers

- [x] **Step 2.1.1: Find every CLI consumer of validator exports**

```bash
grep -rn 'validateGraph\|validateOrRaise' src/cli --include='*.ts'
```

Expected hits today: `src/cli/commands/pipeline.ts` (multiple lines). The grep also surfaces test files under `src/cli/tests/` — those are Chunk 3 work, ignore here.

If any non-test CLI file appears beyond `pipeline.ts`, add it to the modify list below and apply the same import-split treatment.

### Step 2.2: Split the import in `pipeline.ts`

- [x] **Step 2.2.1: Read the current import line**

Open `src/cli/commands/pipeline.ts`. Line 6 (verify by `grep -n 'core/graph' src/cli/commands/pipeline.ts`) is:

```ts
import { parseDot, validateGraph, validateOrRaise } from "../../attractor/core/graph.js";
```

If extra symbols (e.g. `resolveHandlerType`) are pulled in the same line, preserve them on the parser side.

- [x] **Step 2.2.2: Edit the import to split**

Replace the single line with two lines:

```ts
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph, validateOrRaise } from "../../attractor/core/graph-validator.js";
```

If `resolveHandlerType` was on the original line, keep it on the parser-side line: `import { parseDot, resolveHandlerType } from "../../attractor/core/graph.js";`. Use the Edit tool with the original full line as `old_string` to make the change unambiguous.

- [x] **Step 2.2.3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors in `pipeline.ts`. Errors remaining are in test files — Chunk 3.

- [x] **Step 2.2.4: Smoke-run the validate path**

```bash
npx ralph pipeline validate src/cli/pipelines/implement
```

(Or the equivalent invocation that exercises the validate path against a bundled pipeline.) Expected: identical output before vs. after the move — same diagnostic count, same messages, same exit code. If `ralph` is not on `PATH`, run `node dist/cli/index.js pipeline validate src/cli/pipelines/implement` after `npm run build`.

If diagnostic output differs from pre-Chunk-1 behaviour, stop. The byte-identical snapshot from Step 1.2 should have caught this — re-run it now:

```bash
npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts
```

If the snapshot diffs, the move corrupted a rule body. Bisect by reverting `graph-validator.ts` chunks until green.

- [x] **Step 2.2.5: Commit checkpoint**

```bash
git add src/cli/commands/pipeline.ts
git commit -m "refactor(cli/pipeline): import validator from graph-validator.ts

Split single-line import into parser (graph.js) and validator
(graph-validator.js) sources. No behavior change.

Refs: docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md"
```

## Verification targets

- Smokes: `src/cli/pipelines/smoke/*.dot` (validate path only — not run path) — expected identical diagnostics pre vs post
- Manual exercises: `ralph pipeline validate <bundled-pipeline>` for at least one pipeline (e.g. `src/cli/pipelines/implement`)
- Lint: `npx tsc --noEmit` — expected zero errors in `src/cli/commands/`; remaining errors confined to `src/attractor/tests/` and `src/cli/tests/`
- Surfaces touched: CLI validate path

---

## Chunk 3: Update test imports (~30 files)

This is the mechanical sweep. Two test directories, two import-path patterns.

**Files:**
- Modify: every file under `src/attractor/tests/` that imports `validateGraph` or `validateOrRaise` from `../core/graph.js`
- Modify: every file under `src/cli/tests/` that imports `validateGraph` from `../../attractor/core/graph.js`

### Step 3.1: Inventory the test sweep

- [ ] **Step 3.1.1: List attractor tests that pull validateGraph**

```bash
grep -ln 'validateGraph\|validateOrRaise' src/attractor/tests/*.ts
```

Capture the full list. From the design §6 ripple, expected hits include:

```
src/attractor/tests/graph.test.ts
src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts
src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts
src/attractor/tests/graph-required-caller-vars.test.ts
src/attractor/tests/graph-outputs-schema-invalid.test.ts
src/attractor/tests/graph-validator-inputs.test.ts
src/attractor/tests/graph-orphan-output.test.ts
src/attractor/tests/graph-validator-outputs.test.ts
src/attractor/tests/graph-validator-loop-done.test.ts
src/attractor/tests/graph-produces-redundant-broad.test.ts
src/attractor/tests/graph-outputs-derives-produces.test.ts
src/attractor/tests/graph-outputs-conflict.test.ts
src/attractor/tests/graph-inputs-flow.test.ts
src/attractor/tests/graph-validator-auto-inputs-fixture.test.ts
src/attractor/tests/graph-gate-validation.test.ts
src/attractor/tests/graph-portability.test.ts
src/attractor/tests/illumination-pipeline-flow.test.ts
```

The actual list may differ — use the `grep` output, not this hand-list, as the work surface.

- [ ] **Step 3.1.2: List CLI smoke tests that pull validateGraph**

```bash
grep -ln 'validateGraph' src/cli/tests/*.ts
```

Expected hits include all 16 `pipeline-smoke-*-folder.test.ts` files plus `pipeline-implement-folder.test.ts`, `pipeline-janitor-folder.test.ts`, `templates-validate.test.ts`, `pipeline.test.ts`, `pipeline-headless.test.ts`, and any other pipeline test.

### Step 3.2: Apply the import split per file

Each test file has the same edit pattern. Use it as a template; apply it to every file from Step 3.1.

- [ ] **Step 3.2.1: Edit each attractor test file**

For each file in the Step 3.1.1 list, identify the import statement that pulls `validateGraph` (and possibly `validateOrRaise`) from `../core/graph.js`. Two patterns:

**Pattern A — combined with parser:**

```ts
import { parseDot, validateGraph } from "../core/graph.js";
```

becomes:

```ts
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";
```

**Pattern B — validator only:**

```ts
import { validateGraph } from "../core/graph.js";
```

becomes:

```ts
import { validateGraph } from "../core/graph-validator.js";
```

If `validateOrRaise` is imported, it goes on the validator-side line. If `Diagnostic` is imported as a type, it stays on its current `../types.js` source (do not touch).

Use the Edit tool per file with `old_string` matching the full import line for unambiguous replacement.

- [ ] **Step 3.2.2: Edit each CLI smoke test file**

For each file in the Step 3.1.2 list, the relative path is `../../attractor/core/graph.js` instead of `../core/graph.js`. Same Pattern A / Pattern B split:

```ts
import { parseDot, validateGraph } from "../../attractor/core/graph.js";
```

becomes:

```ts
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";
```

- [ ] **Step 3.2.3: Run typecheck on the test surface**

```bash
npx tsc --noEmit
```

Expected: zero errors anywhere.

- [ ] **Step 3.2.4: Run the attractor test suite**

```bash
npx vitest run src/attractor/tests/
```

Expected: all green. The 17 `variable_coverage` cases in `graph.test.ts`, the per-rule validator tests, and the byte-identical snapshot from Step 1.2 all pass without `-u`.

If a test fails:

- Snapshot diff in `graph-validator-byte-identical.test.ts` → the move corrupted a rule. Re-run `git diff` against `src/attractor/core/graph-validator.ts` and the deleted slice in `graph.ts` to spot the byte-difference.
- Import error → an import was missed in Step 3.2.1 / 3.2.2.
- Behaviour change in a per-rule test → a private helper migrated incorrectly. Verify against Step 1.4.2's helper-move policy.

- [ ] **Step 3.2.5: Run the CLI smoke suite**

```bash
npx vitest run src/cli/tests/
```

Expected: all green. Smoke tests assert zero error-level diagnostics on bundled pipelines.

- [ ] **Step 3.2.6: Run the full test suite**

```bash
npx vitest run
```

Expected: full green. This is the gate to commit Chunk 3.

- [ ] **Step 3.2.7: Commit checkpoint**

```bash
git add src/attractor/tests/ src/cli/tests/
git commit -m "refactor(tests): import validateGraph from graph-validator.ts

Mechanical import-path split across 30+ test files. Pattern: parseDot
keeps its source (graph.js); validateGraph / validateOrRaise route
through the new graph-validator.js. No test logic changes.

Full suite green; byte-identical snapshot pins diagnostic equivalence.

Refs: docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md"
```

## Verification targets

- Smokes: every `src/cli/pipelines/smoke/*.dot` exercised by `pipeline-smoke-*-folder.test.ts` (~16 files)
- Manual exercises: `ralph pipeline validate src/cli/pipelines/implement`; `ralph pipeline run src/cli/pipelines/implement` against a known-good fixture (expected: identical exit code + identical `pipeline.jsonl` modulo timestamps + IDs)
- Lint: `npx tsc --noEmit`; `npx vitest run`
- Surfaces touched: validator core, parser core, CLI validate path, full test suite

---

## Chunk 4: ADR + final commit squash

The new ADR records the parser/validator split as an instance of ADR-0001 + ADR-0004. Final step squashes Chunks 1–4 into one commit per design §8.

**Files:**
- Create: `docs/adr/0009-parser-validator-split.md`

### Step 4.1: Pick the next ADR number

- [ ] **Step 4.1.1: List existing ADRs**

```bash
ls docs/adr/
```

Expected: `0001-…` through `0008-…`. Next number is `0009`. If the directory has changed since this plan was written, use the next-available number and update the file path below.

### Step 4.2: Write the ADR

- [ ] **Step 4.2.1: Create `docs/adr/0009-parser-validator-split.md`**

Write the file with this content (substitute today's date and adjust the ADR number if the directory advanced):

```markdown
# ADR-0009: Parser and validator live in separate files

**Date:** 2026-05-05
**Status:** Accepted

## Context

`src/attractor/core/graph.ts` carried two unrelated jobs in the same 1187-line file: the parser (`parseDot`, `string → Graph`) and the validator (`validateGraph` + 11 private `check*` rules + `validateOrRaise`). The validator pulled in four cross-cutting deps (`agent-loader`, `flow-analyzer`, `conditions`, `gate-registry`) that the parser does not use. Adding a 12th rule meant another function in an already-monolithic file. The 11 `check*` helpers were all private to the file — verified by repo-wide grep — so the seam was clean.

ADR-0001 endorsed single-purpose modules (`agent-loader.ts` as the canonical example). ADR-0004 ("source as truth, no behavioural specs") accepted internal restructuring whose only signal is the source itself. Recent commits (`c8370da` split `AgentHandler`, `4b67e07` extracted `assembleAgentPrompt`, `1fa6811` deleted parallel/conditional handlers) showed momentum toward focused modules.

## Decision

Extract the validator into `src/attractor/core/graph-validator.ts`:

- `validateGraph` + 11 `check*` rules + `validateOrRaise` move verbatim — no rule edits, no diagnostic-message edits, no signature changes.
- The four validator-only imports (`agent-loader`, `flow-analyzer`, `conditions`, `gate-registry`) move with the validator.
- `KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE` (touched by both parser and validator) stay in `graph.ts` and are re-exported so `graph-validator.ts` imports them from a single canonical location.
- `graph.ts` retains `parseDot`, `resolveHandlerType`, the shared constants, and any helpers `parseDot` calls.
- One module, not a `checks/<rule>.ts` directory — the 11 rules average ~50 lines each; per-file overhead is noisier than the body. Mirror the existing `src/attractor/handlers/` convention (one file per handler, no per-handler directory). If a future rule outgrows the average, that rule alone can move to its own file.

Public exports (`parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise`, `Diagnostic`) keep their signatures verbatim. Diagnostic strings stay byte-identical, pinned by `src/attractor/tests/graph-validator-byte-identical.test.ts`.

## Consequences

- "Where do I add a new validation rule?" gets a one-word answer: `graph-validator.ts`.
- `graph.ts` advertises a parser and is one.
- The two designs `2026-05-04-janitor-graph-validator-bloat-design.md` and this one commute. If the bloat-design ships first, this design imports its `createGraphTraversal` from wherever it landed. If this design ships first, the bloat-design re-points its line citations to `graph-validator.ts`.
- No re-export shim from `graph.ts` — see design §7.2. The import-path move is the canonical signal that the validator no longer lives in the parser file.

## References

- ADR-0001 (single-purpose modules)
- ADR-0004 (source as truth, no behavioural specs)
- Originating illumination: `meditations/illuminations/2026-05-05T1028-graph-ts-parser-validator-conflation.md`
- Design doc: `docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md`
```

### Step 4.3: Final verification

- [ ] **Step 4.3.1: Re-run the full test suite**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: full green.

- [ ] **Step 4.3.2: Re-run a build**

```bash
npm run build
```

Expected: `tsup` succeeds, `dist/` shape gains one new file (`dist/.../core/graph-validator.js`). No new bin entries, no removed ones. List `dist/attractor/core/`:

```bash
ls dist/attractor/core/ | grep graph
```

Expected: `graph.js`, `graph-validator.js`, `graph-ast.js`, plus the existing siblings.

- [ ] **Step 4.3.3: Smoke against bundled pipelines**

```bash
ralph pipeline validate src/cli/pipelines/implement
ralph pipeline validate src/cli/pipelines/janitor-graph-bloat-illumination 2>/dev/null || true
```

Expected: identical diagnostic output before vs after — confirmed against the byte-identical snapshot test from Step 1.2.

- [ ] **Step 4.3.4: Negative-case smoke**

Author or pick one deliberately-invalid `.dot` (e.g. an existing fixture with an orphan output) and run:

```bash
ralph pipeline validate <invalid.dot>
```

Expected: identical `Diagnostic` array (same `code`, `message`, `severity`, `line/col/source`) before and after the move. The byte-identical snapshot test asserts this for every fixture; this manual smoke is the user-facing confirmation.

### Step 4.4: Commit ADR + squash

- [ ] **Step 4.4.1: Commit the ADR**

```bash
git add docs/adr/0009-parser-validator-split.md
git commit -m "docs(adr): record parser/validator split as ADR-0009

Documents the structural extraction of validateGraph into
graph-validator.ts. References ADR-0001 (single-purpose modules)
and ADR-0004 (source as truth) as predecessors.

Refs: docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md"
```

- [ ] **Step 4.4.2: Squash the four checkpoint commits into one**

Design §8 demands a single commit. Run interactive rebase:

```bash
git rebase -i HEAD~4
```

In the editor, mark commits 2, 3, 4 as `s` (squash) and commit 1 as `pick`. Save. In the combined message editor, replace the concatenated messages with:

```
refactor(attractor/core): extract validateGraph into graph-validator.ts

Split src/attractor/core/graph.ts (1187 lines) into a parser-only
graph.ts and a new graph-validator.ts that owns validateGraph + 11
private check* rules + validateOrRaise. The four validator-only
imports (agent-loader, flow-analyzer, conditions, gate-registry)
follow the validator. KNOWN_TYPES / UNIMPLEMENTED_TYPES /
SHAPE_TO_TYPE stay in graph.ts as the canonical type-recognition
source and are imported by graph-validator.ts.

Public exports (parseDot, resolveHandlerType, validateGraph,
validateOrRaise, Diagnostic) keep their signatures verbatim.
Diagnostic strings stay byte-identical, pinned by
graph-validator-byte-identical.test.ts.

Updates: 1 CLI consumer (pipeline.ts) + ~30 test files
(src/attractor/tests/* and src/cli/tests/pipeline-*-folder.test.ts).
Adds ADR-0009 documenting the parser/validator split.

Refs:
- docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md
- docs/adr/0009-parser-validator-split.md
- meditations/illuminations/2026-05-05T1028-graph-ts-parser-validator-conflation.md
```

If interactive rebase is blocked by tooling (no editor), use the alternative:

```bash
git reset --soft HEAD~4
git commit -F - <<'EOF'
refactor(attractor/core): extract validateGraph into graph-validator.ts

[…full message above…]
EOF
```

`git reset --soft` is destructive only of commit history — the file changes stay staged. Confirm the staged tree matches the four-commit aggregate:

```bash
git status
git diff --cached --stat
```

Expected: ~33 modified files (`graph.ts` shrunk, `pipeline.ts` import split, ~30 test files import-split), 4 new files (`graph-validator.ts`, `graph-validator-byte-identical.test.ts`, the snapshot file under `__snapshots__/`, `0009-parser-validator-split.md`), zero deletions of unrelated files.

- [ ] **Step 4.4.3: Run full test suite one more time**

```bash
npx vitest run && npx tsc --noEmit && npm run build
```

Expected: full green. This is the merge gate.

- [ ] **Step 4.4.4: Confirm public-export grep guarantees**

Per design §10.1:

```bash
grep -rn 'export function validateGraph' src/
```

Expected: exactly 1 hit, in `src/attractor/core/graph-validator.ts`.

```bash
grep -rn 'check[A-Z]\w*(' src/ --include='*.ts' | grep -v graph-validator.ts | grep -v 'graph.ts:.*check'
```

Expected: zero hits — all 11 `check*` helpers are private to `graph-validator.ts`.

```bash
grep -rn "from ['\"].*core/graph['\"]" src/ --include='*.ts'
grep -rn "from ['\"].*core/graph\\.js['\"]" src/ --include='*.ts' | grep -v 'core/graph-validator'
```

Expected: only parser callers (`parseDot`, `resolveHandlerType`, the shared constants) hit `core/graph`. All `validateGraph` / `validateOrRaise` consumers route through `core/graph-validator`.

## Verification targets

- Smokes: every `src/cli/pipelines/smoke/*.dot` exercised by `pipeline-smoke-*-folder.test.ts` (~16 files); both `pipeline-implement-folder.test.ts` and `pipeline-janitor-folder.test.ts`
- Manual exercises: `ralph pipeline validate src/cli/pipelines/implement`; `ralph pipeline run src/cli/pipelines/implement` against a known-good fixture (expected: identical exit code, identical `pipeline.jsonl` modulo timestamps + IDs); negative-case validate against a deliberately-invalid `.dot`
- Lint: `npx tsc --noEmit`; `npx vitest run`; `npm run build`
- Surfaces touched: validator core, parser core, CLI validate path, full test suite, ADR docs

---

## Open questions

- **Coordination with `2026-05-04-janitor-graph-validator-bloat-design.md`.** The two designs commute (design §3.4). Whichever ships first determines whether the other re-points its line citations. No mechanical conflict.
- **`KNOWN_TYPES` / `UNIMPLEMENTED_TYPES` / `SHAPE_TO_TYPE` long-term home.** Design §3.3 keeps them in `graph.ts`. A future refactor may extract them to a `node-types.ts`. Out of scope.
- **Codemod vs hand-edit for the 30-test sweep.** Step 3.2 prescribes hand-edit per file; if the agent prefers a codemod (`sed` or `ts-morph`), the import-pattern is regular enough to script. Either approach lands the same diff.
