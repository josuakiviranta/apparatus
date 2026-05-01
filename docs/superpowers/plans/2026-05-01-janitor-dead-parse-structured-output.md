---
status: complete
---

# Janitor — Delete Dead `parseStructuredOutput` Helper Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Delete the orphan `parseStructuredOutput` helper module and its self-loop test file so `src/cli/lib/` no longer hosts a public export with zero production callers.

**Architecture:** Pure subtraction in a single atomic commit. Delete `src/cli/lib/parse-structured-output.ts` and `src/cli/lib/parse-structured-output.test.ts` together — splitting them produces an intermediate state where `tsc` fails (test imports a missing module) or a dead export persists (defeats the cleanup). No replacement helper, no edits to `src/attractor/handlers/evaluate-agent-output.ts` or `agent-handler.ts`.

**Tech Stack:** TypeScript, Node.js, vitest, tsup, ESM. No new tooling.

**Originating illumination:** `meditations/illuminations/2026-05-01T0921-janitor-dead-parse-structured-output.md`
**Design doc:** `docs/superpowers/specs/2026-05-01-janitor-dead-parse-structured-output-design.md`

---

## File Structure

This plan touches two files, both delete-only:

| File | Role | Action |
|---|---|---|
| `src/cli/lib/parse-structured-output.ts` | Single export `parseStructuredOutput(rawText: string): unknown[]`. Zero non-test importers in repo. | `git rm` whole. |
| `src/cli/lib/parse-structured-output.test.ts` | Sole importer of the helper. 7 `it` cases inside one `describe("parseStructuredOutput", ...)`. Orphans on production-file removal. | `git rm` whole. |

Out of scope (locked by design §2 + chat-summarizer Round 1): no edits to `src/attractor/handlers/evaluate-agent-output.ts`, `src/attractor/handlers/agent-handler.ts`, neighbouring files in `src/cli/lib/`, or `MEMORY.md` (no auto-memory note pins this helper — verified by design §2).

---

## Chunk 1: Delete the dead helper and its test

This chunk is the entire change. Two `git rm` calls, one commit. The deletions are atomic by construction (design §3.4): the test file imports from the helper, so they cannot ship in different commits without breaking either type-check or the cleanup intent.

### Task 1: Baseline verification — confirm dead-code claim still holds

**Files:** None modified.

- [x] **Step 1: Capture a green baseline from the full vitest suite**

Run from repo root:

```bash
npx vitest run
```

Expected: all tests pass. Note the pass count; Task 5 must equal this minus the 7 `it` cases in the deleted file.

- [x] **Step 2: Confirm zero non-test callers of `parseStructuredOutput`**

Run from repo root:

```bash
grep -rn "parseStructuredOutput\|parse-structured-output" src/ pipelines/ scripts/ package.json tsup.config.ts --include="*.ts" --include="*.js" --include="*.json" --include="*.dot" --include="*.yml" --include="*.yaml" 2>/dev/null | grep -v "src/cli/lib/parse-structured-output\.ts" | grep -v "src/cli/lib/parse-structured-output\.test\.ts"
```

Expected output: empty (no lines printed). Any hit means a new caller appeared since the design doc was written — pause and re-design before proceeding.

- [x] **Step 3: Confirm the production file matches the design doc**

Run from repo root:

```bash
sed -n '1,5p' src/cli/lib/parse-structured-output.ts
```

Expected output (verbatim):

```
/**
 * Parse structured output that may be a JSON array, single JSON object,
 * or newline-delimited JSON (NDJSON). Non-JSON lines are silently skipped.
 */
export function parseStructuredOutput(rawText: string): unknown[] {
```

If the lines differ, pause — file has drifted since the design doc; re-ground before edits.

- [x] **Step 4: Confirm the test file matches the design doc**

Run from repo root:

```bash
sed -n '1,4p' src/cli/lib/parse-structured-output.test.ts
```

Expected output (verbatim):

```
import { describe, it, expect } from "vitest";
import { parseStructuredOutput } from "./parse-structured-output.js";

describe("parseStructuredOutput", () => {
```

If lines differ, pause and re-ground.

- [x] **Step 5: Confirm the live JSON-extraction path is intact and unrelated**

Run from repo root:

```bash
grep -n "evaluateAgentOutput" src/attractor/handlers/agent-handler.ts src/attractor/handlers/evaluate-agent-output.ts
```

Expected: at least one `import` line in `agent-handler.ts`, two call sites in `agent-handler.ts` (around lines 260 and 289), and one `export function evaluateAgentOutput(` in `evaluate-agent-output.ts` (around line 16). This is a sanity check — the live path is the reason the orphan can be safely removed.

### Task 2: Delete the test file

**Files:**
- Delete: `src/cli/lib/parse-structured-output.test.ts`

The test file is removed first so intermediate working-tree state never has a test importing a missing module.

- [x] **Step 1: Delete the test file with git**

Run from repo root:

```bash
git rm src/cli/lib/parse-structured-output.test.ts
```

Expected output: `rm 'src/cli/lib/parse-structured-output.test.ts'`.

- [x] **Step 2: Confirm the file is staged for deletion**

Run from repo root:

```bash
git status --short src/cli/lib/parse-structured-output.test.ts
```

Expected output: `D  src/cli/lib/parse-structured-output.test.ts` (capital D in column 1, indicating staged deletion).

- [x] **Step 3: Confirm no other file imports the deleted test**

Run from repo root:

```bash
grep -rn "parse-structured-output\.test" src/ --include="*.ts"
```

Expected output: empty. Test files are not imported elsewhere; this is a paranoia check.

### Task 3: Delete the production module

**Files:**
- Delete: `src/cli/lib/parse-structured-output.ts`

- [x] **Step 1: Delete the production module with git**

Run from repo root:

```bash
git rm src/cli/lib/parse-structured-output.ts
```

Expected output: `rm 'src/cli/lib/parse-structured-output.ts'`.

- [x] **Step 2: Confirm both files are staged for deletion**

Run from repo root:

```bash
git status --short src/cli/lib/parse-structured-output.ts src/cli/lib/parse-structured-output.test.ts
```

Expected output (two lines):

```
D  src/cli/lib/parse-structured-output.ts
D  src/cli/lib/parse-structured-output.test.ts
```

- [x] **Step 3: Confirm `git ls-files` no longer tracks either file**

Run from repo root:

```bash
git ls-files src/cli/lib/parse-structured-output.*
```

Expected output: empty (the staged deletions remove them from the tracked set).

### Task 4: Static checks pass with both files gone

**Files:** None modified.

- [x] **Step 1: Repo-wide grep returns zero hits in shipping code**

Run from repo root:

```bash
grep -rn "parseStructuredOutput\|parse-structured-output" src/ pipelines/ scripts/ package.json tsup.config.ts --include="*.ts" --include="*.js" --include="*.json" --include="*.dot" --include="*.yml" --include="*.yaml" 2>/dev/null
```

Expected output: empty. Hits in `meditations/illuminations/` or `docs/superpowers/` are historical and outside the grep scope above; do not widen the scope.

- [x] **Step 2: TypeScript compiles cleanly**

Run from repo root:

```bash
npx tsc --noEmit
```

Expected: zero errors. Any error means a stale reference survived in shipping code (Task 4 Step 1 should have caught it; if `tsc` complains and the grep was empty, re-run the grep without the `--include` filters to find dynamic references).

### Task 5: Regression suite

**Files:** None modified.

- [x] **Step 1: Run the full vitest suite**

Run from repo root:

```bash
npx vitest run
```

Expected: all remaining tests pass. The pass count equals the Task 1 Step 1 baseline minus the 7 `it` cases from the deleted `parseStructuredOutput` describe block. No suite imports `./parse-structured-output.js` (verified by Task 2 Step 3 + Task 4 Step 1).

- [x] **Step 2: Run the live JSON-extraction tests explicitly**

Run from repo root:

```bash
npx vitest run src/attractor/handlers
```

Expected: all `evaluateAgentOutput` tests pass. This is the regression check on the live path — the deletion must not perturb it.

- [x] **Step 3: Build the bundle**

Run from repo root:

```bash
npm run build
```

Expected: `tsup` exits 0; `dist/cli/index.js` exists and is non-empty. No new warnings related to `parse-structured-output`.

- [x] **Step 4: Smoke the CLI surface — top-level help is unchanged**

Run from repo root:

```bash
node dist/cli/index.js --help
```

Expected: top-level help printed; the listed commands include `heartbeat`, `implement`, `meditate`, `pipeline`. No commands appear or disappear. (The deleted helper was never wired into Commander; the surface is identical by construction.)

### Task 6: Commit the deletion as a single atomic change

**Files:**
- Already staged: `src/cli/lib/parse-structured-output.ts` (deleted), `src/cli/lib/parse-structured-output.test.ts` (deleted).

- [x] **Step 1: Confirm the staged diff is exactly the two deletions**

Run from repo root:

```bash
git diff --cached --stat
```

Expected output: two files changed, only deletions. Roughly:

```
 src/cli/lib/parse-structured-output.test.ts | 45 ---------
 src/cli/lib/parse-structured-output.ts      | 29 -------
 2 files changed, 74 deletions(-)
```

Line counts may vary by ±1 due to trailing-newline rendering; the shape (two files, deletions only, zero insertions) must match.

- [x] **Step 2: Confirm zero insertions in the staged diff**

Run from repo root:

```bash
git diff --cached --numstat
```

Expected output: two lines, each with `0` in the insertions column (first column) and a positive integer in the deletions column (second column). Any non-zero in the first column means an unrelated edit slipped in — abort and inspect.

- [x] **Step 3: Commit**

Run from repo root:

```bash
git commit -m "$(cat <<'EOF'
chore(lib): delete unused parseStructuredOutput helper

Removes the speculative NDJSON/JSON parser that no shipping code
consumes. Whole-repo verification confirmed zero callers across
src/, pipelines/, scripts/, package.json, and tsup.config.ts; the
sole importer was the matching test file. Deletes:

- src/cli/lib/parse-structured-output.ts (single export, 29 lines).
- src/cli/lib/parse-structured-output.test.ts (sole importer, 7
  it cases — orphaned on production-file removal).

The live agent-output JSON-extraction path remains anchored at
src/attractor/handlers/evaluate-agent-output.ts:evaluateAgentOutput,
called from src/attractor/handlers/agent-handler.ts. No behaviour
change to heartbeat, implement, meditate, or pipeline.
EOF
)"
```

Expected: commit succeeds. Capture the SHA for the verifier downstream.

- [x] **Step 4: Confirm working tree is clean for the touched paths**

Run from repo root:

```bash
git status --short src/cli/lib/
```

Expected output: empty (no `??`, no `M`, no `D` lines for `src/cli/lib/`). Any remaining marker means the commit missed a file.

## Verification targets

- Smokes: None (no pipeline behaviour change; deleted helper was unreachable from any `.dot` graph)
- Manual exercises: `node dist/cli/index.js --help` post-build (top-level help unchanged); `git ls-files src/cli/lib/parse-structured-output.*` returns empty
- Lint: `npx tsc --noEmit`, `npx vitest run`, `npx vitest run src/attractor/handlers`
- Surfaces touched: None (helper was never reachable from any CLI command)

---

## Open questions

None. Design doc §8 already declared the design open-question list closed; the plan inherits that closure. The two-file scope is locked by chat-summarizer Round 1 ("Scope stays at verifier's original two files; no broader refactor"). If the reviewer surfaces an issue that demands scope expansion, escalate to the user rather than silently widening — per writer-instructions hard rule on iteration cap.
