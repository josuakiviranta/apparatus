# Partial Revert of `.ralph/` — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `CONTEXT.md`, `VISION.md`, `docs/adr/` from `.ralph/` back to repo root; finish migrating root `pipelines/` (→ `.ralph/pipelines/` and `.ralph/scenarios/`) and root `memory/` (→ `.ralph/sessions/`) into `.ralph/`; rename `memoryDir`→`sessionsDir`; write ADR-0008 documenting the partition principle.

**Architecture:** Seven staged commits. Each commit leaves the repo passing `npx tsc --noEmit`, `npx vitest run`, and the smoke-pipeline suite. Code edits land before file moves so tests can be updated atomically with the moves they cover. Pipeline-prompt edits land before the `memory/` `git mv` so the live `memory-writer` node never references the wrong path.

**Tech Stack:** TypeScript, Vitest, tsup, ralph-cli's pipeline DSL (`.dot` + agent `.md`).

**Spec:** `docs/superpowers/specs/2026-05-04-ralph-folder-partial-revert-design.md`

**Pre-flight requirement:** Read the spec end-to-end before starting. The §1.2 two-clause partition principle and §8 commit-ordering constraints are load-bearing.

---

## File structure plan

| File | Status | Responsibility |
|------|--------|---------------|
| `src/cli/lib/ralph-paths.ts` | modified | Drop `docsAdrDir()`; rename `memoryDir()` → `sessionsDir()` returning `.ralph/sessions`. |
| `src/cli/commands/init.ts` | modified | Scaffold `CONTEXT.md`, `VISION.md`, `docs/adr/` at repo root; scaffold `.ralph/sessions/` instead of `.ralph/memory/`. |
| `src/cli/program.ts` | modified | Help-text edits at lines 95 and 194. |
| `src/cli/tests/ralph-paths.test.ts` | modified | Drop `docsAdrDir` test; rename memory→sessions test. |
| `src/cli/tests/init.test.ts` | modified | Flip path assertions to root for CONTEXT/VISION/docs-adr; expect `.ralph/sessions` instead of `.ralph/memory`. |
| `src/tests/scenarios/ralph-init-scaffolds-tree.md` | modified | Flip path assertions. |
| `src/tests/scenarios/ralph-init-idempotent.md` | modified | Flip path assertions. |
| `src/attractor/tests/illumination-pipeline-flow.test.ts` | modified | Path constants → `.ralph/pipelines/illumination-to-implementation`. |
| `src/attractor/tests/dual-parser.test.ts` | modified | `roots` array → `[".ralph/pipelines", ".ralph/scenarios"]`. |
| `src/cli/tests/pipeline-smoke-*-folder.test.ts` (14 files) | modified | `REPO_ROOT/pipelines/smoke/` → `REPO_ROOT/.ralph/scenarios/`. |
| `pipelines/illumination-to-implementation/memory-writer.md` | modified | Write target `$project/memory/` → `$project/.ralph/sessions/` at lines 49 + 144. |
| `pipelines/illumination-to-implementation/verifier.md` | modified | Example string `.ralph/docs/adr/0007-…` → `docs/adr/0007-…` at line 83. |
| `.ralph/CONTEXT.md` → `CONTEXT.md` | moved + rewritten | git mv + multi-section content rewrite. |
| `.ralph/VISION.md` → `VISION.md` | moved + 2-line edit | git mv + lines 30, 32 edits. |
| `.ralph/docs/adr/` → `docs/adr/` | moved | git mv. |
| `pipelines/illumination-to-implementation/` → `.ralph/pipelines/illumination-to-implementation/` | moved | git mv (21 files). |
| `pipelines/smoke/` → `.ralph/scenarios/` | moved | git mv (~40 files across 14 subdirs). |
| `memory/` → `.ralph/sessions/` | moved | git mv (18 files). |
| `.ralph/memory/` | removed | rmdir empty. |
| `docs/adr/0008-partial-revert-of-ralph-folder.md` | created | New ADR documenting partition principle + supersession. |
| `docs/adr/0007-ralph-folder-as-project-local-home.md` | modified | One-line footer pointing at ADR-0008. |
| `README.md` | modified | Lines 14, 37, 61, 170-173, 184-198, 202. |
| `AGENTS.md` | modified | Line 17. |
| `IMPLEMENTATION_PLAN.md` | deleted | Stale. |

---

## Chunk 1: Code edits — `ralph-paths.ts`, `init.ts`, `program.ts`, tests

Goal: every code-level path constant reflects the partial-revert layout. No file moves yet. After this commit, `npx tsc --noEmit` and `npx vitest run src/cli/tests/ralph-paths.test.ts src/cli/tests/init.test.ts` pass; full vitest passes too because no file moves invalidate other tests yet (test fixtures and `.ralph/CONTEXT.md` still exist at their pre-revert locations).

**Files:**
- Modify: `src/cli/lib/ralph-paths.ts`
- Modify: `src/cli/tests/ralph-paths.test.ts`
- Modify: `src/cli/commands/init.ts`
- Modify: `src/cli/tests/init.test.ts`
- Modify: `src/tests/scenarios/ralph-init-scaffolds-tree.md`
- Modify: `src/tests/scenarios/ralph-init-idempotent.md`
- Modify: `src/cli/program.ts`

### Tasks

- [x] **1.1: Update `ralph-paths.ts` test first (TDD red).**

Read current `src/cli/tests/ralph-paths.test.ts`. Replace the `memoryDir` test with the renamed `sessionsDir` test, and delete the `docsAdrDir` test entirely.

```typescript
// Remove: it("docsAdrDir joins .ralph/docs/adr", () => { ... });
// Remove: import { docsAdrDir } from "../lib/ralph-paths.js";

// Replace memoryDir test with:
import { sessionsDir } from "../lib/ralph-paths.js";

it("sessionsDir joins .ralph/sessions", () => {
  expect(sessionsDir("/abs/project")).toBe("/abs/project/.ralph/sessions");
});
```

- [x] **1.2: Run the test to verify red.**

Run: `npx vitest run src/cli/tests/ralph-paths.test.ts`
Expected: FAIL — `sessionsDir` is not exported, `docsAdrDir` is.

- [x] **1.3: Update `ralph-paths.ts` (green).**

In `src/cli/lib/ralph-paths.ts`:
- Delete the `docsAdrDir` export (lines ~24-26).
- Rename the `memoryDir` export to `sessionsDir`, returning `<project>/.ralph/sessions`.

```typescript
// Before:
export function memoryDir(projectRoot: string): string {
  return join(projectRoot, ".ralph", "memory");
}
export function docsAdrDir(projectRoot: string): string {
  return join(projectRoot, ".ralph", "docs", "adr");
}

// After (docsAdrDir removed entirely):
export function sessionsDir(projectRoot: string): string {
  return join(projectRoot, ".ralph", "sessions");
}
```

- [x] **1.4: Run ralph-paths.test.ts (verify green).**

Run: `npx vitest run src/cli/tests/ralph-paths.test.ts`
Expected: PASS.

- [x] **1.5: Run `npx tsc --noEmit` to find broken callers.**

Expected: errors at every `import { memoryDir }` or `import { docsAdrDir }` site. Should be `init.ts` and `init.test.ts`.

- [x] **1.6: Update `init.test.ts` first (TDD red — assertions flip).**

Read current file (~85 lines). Update path assertions:
- Line 32: `existsSync(join(projectDir, ".ralph/docs/adr"))` → `existsSync(join(projectDir, "docs/adr"))`.
- Line 33: `existsSync(join(projectDir, ".ralph/VISION.md"))` → `existsSync(join(projectDir, "VISION.md"))`.
- Line 34: `existsSync(join(projectDir, ".ralph/CONTEXT.md"))` → `existsSync(join(projectDir, "CONTEXT.md"))`.
- Line 50, 52: `.ralph/VISION.md` → `VISION.md`.
- Line 72-78: `.ralph/VISION.md` → `VISION.md`, `.ralph/CONTEXT.md` → `CONTEXT.md`.
- Line 89: `.ralph/docs/adr` → `docs/adr`.
- Add new assertion (after existing dir checks): `expect(existsSync(join(projectDir, ".ralph/sessions"))).toBe(true);`.
- Replace any reference to `.ralph/memory` with `.ralph/sessions`.

- [x] **1.7: Run init.test.ts to verify red.**

Run: `npx vitest run src/cli/tests/init.test.ts`
Expected: FAIL — `init.ts` still scaffolds the old layout.

- [x] **1.8: Update `init.ts` (green).**

Read current `src/cli/commands/init.ts` (~80 lines). Apply edits:

- Line 9-10: imports — drop `docsAdrDir`, replace `memoryDir` with `sessionsDir`.

```typescript
// Before:
import {
  ralphDir, meditationsDir, illuminationsDir, stimuliDir,
  memoryDir, docsAdrDir, pipelinesDir,
} from "../lib/ralph-paths.js";

// After:
import {
  ralphDir, meditationsDir, illuminationsDir, stimuliDir,
  sessionsDir, pipelinesDir,
} from "../lib/ralph-paths.js";
```

- Lines 15-21 (the dirs array): drop `docsAdrDir(projectRoot)`, replace `memoryDir(projectRoot)` with `sessionsDir(projectRoot)`. Add a new entry for the root `docs/adr/` dir.

```typescript
// New dirs array shape (preserve existing entries; just swap the listed ones):
const dirs = [
  ralphDir(projectRoot),
  pipelinesDir(projectRoot),
  meditationsDir(projectRoot),
  illuminationsDir(projectRoot),
  stimuliDir(projectRoot),
  sessionsDir(projectRoot),               // was memoryDir
  join(projectRoot, "docs", "adr"),       // was docsAdrDir(projectRoot) but at root
];
```

- Lines 27-32: `writeFileSync` calls for `CONTEXT.md`, `VISION.md`, `README.md`. Update target paths so `CONTEXT.md` and `VISION.md` write to `projectRoot` (not `ralphDir(projectRoot)`).

```typescript
// Before:
const visionPath = join(ralphDir(projectRoot), "VISION.md");
const contextPath = join(ralphDir(projectRoot), "CONTEXT.md");

// After:
const visionPath = join(projectRoot, "VISION.md");
const contextPath = join(projectRoot, "CONTEXT.md");
```

- [x] **1.9: Run init.test.ts (verify green).**

Run: `npx vitest run src/cli/tests/init.test.ts`
Expected: PASS.

- [x] **1.10a: Update `src/tests/scenarios/ralph-init-scaffolds-tree.md`.**

Read the file. Then edit lines 16-18:
```
- directory `init-smoke/.ralph/docs/adr` exists      → `init-smoke/docs/adr`
- file `init-smoke/.ralph/VISION.md` exists ...       → `init-smoke/VISION.md`
- file `init-smoke/.ralph/CONTEXT.md` exists ...      → `init-smoke/CONTEXT.md`
```
Add a new assertion line under the existing dir checks: `- directory init-smoke/.ralph/sessions exists`.

- [x] **1.10b: Update `src/tests/scenarios/ralph-init-idempotent.md`.**

Read the file. Then flip lines 7-8 and 16-17: `idem-smoke/.ralph/VISION.md` → `idem-smoke/VISION.md`; same for `CONTEXT.md`. Run `git diff src/tests/scenarios/ralph-init-idempotent.md` after to verify.

- [x] **1.11: Update `program.ts` line 95 (init `addHelpText`).**

Exact before (one long line in the file):

```typescript
.addHelpText("after", "\nExamples:\n  ralph init             # in cwd\n  ralph init my-app      # in ./my-app\n\nCreates .ralph/{pipelines,meditations,memory,docs/adr,runs}, scaffolds empty\nVISION.md and CONTEXT.md, runs 'git init -b main' if not already a repo, and\nappends .ralph/runs/ to .gitignore. Safe to run on existing projects — never\noverwrites files.\n")
```

Exact after:

```typescript
.addHelpText("after", "\nExamples:\n  ralph init             # in cwd\n  ralph init my-app      # in ./my-app\n\nCreates .ralph/{pipelines,meditations/{illuminations,stimuli},sessions,runs}\nplus root docs/adr/, scaffolds empty CONTEXT.md, VISION.md, README.md at\nrepo root, runs 'git init -b main' if not already a repo, and appends\n.ralph/runs/ to .gitignore. Safe to run on existing projects — never\noverwrites files.\n")
```

- [x] **1.12: Update `program.ts` line 194 (pipeline-show example).**

Verify line 194 contains `ralph pipeline show pipelines/illumination-to-implementation/pipeline.dot` (in an `addHelpText` block). Replace `pipelines/` with `.ralph/pipelines/`:

```
ralph pipeline show pipelines/illumination-to-implementation/pipeline.dot
   ↓
ralph pipeline show .ralph/pipelines/illumination-to-implementation/pipeline.dot
```

- [x] **1.13: Run full vitest + tsc.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. Note: tests reading or writing the live `.ralph/CONTEXT.md` etc. don't exist; init tests use temp dirs.

- [x] **1.14: Commit.**

```bash
git add src/cli/lib/ralph-paths.ts src/cli/tests/ralph-paths.test.ts \
        src/cli/commands/init.ts src/cli/tests/init.test.ts \
        src/tests/scenarios/ralph-init-scaffolds-tree.md \
        src/tests/scenarios/ralph-init-idempotent.md \
        src/cli/program.ts
git commit -m "refactor: revert CONTEXT/VISION/docs-adr scaffold to repo root

memoryDir → sessionsDir; docsAdrDir deleted. ralph init now
scaffolds CONTEXT.md, VISION.md, docs/adr/ at repo root and
.ralph/sessions/ for memory-writer output."
```

---

## Chunk 2: Pipeline-prompt edits — `memory-writer.md`, `verifier.md`

Goal: the `memory-writer` pipeline node, when next invoked, writes to `.ralph/sessions/` instead of root `memory/`. Verifier example string flips. These edits land **before** any `git mv` of the live `memory/` directory so the prompt and the directory layout never disagree.

**Files:**
- Modify: `pipelines/illumination-to-implementation/memory-writer.md`
- Modify: `pipelines/illumination-to-implementation/verifier.md`

### Tasks

- [x] **2.1: Update `memory-writer.md` line 49 (write-target path).**

```
$project/memory/YYYY-MM-DD-<slug>.md
   ↓
$project/.ralph/sessions/YYYY-MM-DD-<slug>.md
```

- [x] **2.2: Update `memory-writer.md` line 144 (no-writes-outside guard).**

```
No writes outside $project/memory/
   ↓
No writes outside $project/.ralph/sessions/
```

- [x] **2.3: Verify no other `memory/` references in `memory-writer.md`.**

Run: `grep -n "memory/" pipelines/illumination-to-implementation/memory-writer.md`
Expected: zero hits, or only hits inside `.ralph/sessions/` paths.

- [x] **2.4: Update `verifier.md` line 83 example string.**

```
"ADR subagent confirmed the resume contract at `.ralph/docs/adr/0007-…`"
   ↓
"ADR subagent confirmed the resume contract at `docs/adr/0007-…`"
```

- [x] **2.5: Sanity-read both prompts end-to-end.**

The narrative around the edited lines must remain coherent. Specifically: in `verifier.md`, line 83 sits inside a longer explanation of attribution; the edit must not break sentence flow.

- [x] **2.6: Commit.**

```bash
git add pipelines/illumination-to-implementation/memory-writer.md \
        pipelines/illumination-to-implementation/verifier.md
git commit -m "refactor(pipelines): memory-writer writes to .ralph/sessions/

memory-writer.md target path: \$project/memory/ → \$project/.ralph/sessions/.
verifier.md example string: .ralph/docs/adr/ → docs/adr/.
Edits land before the corresponding git mv so the live pipeline
node never references a missing path."
```

---

## Chunk 3: Move third-party convention files back to root

Goal: `CONTEXT.md`, `VISION.md`, `docs/adr/` return to repo root. AGENTS.md reference flips. After this commit, third-party skills that hard-code root paths land correctly.

**Files (moved):**
- `git mv .ralph/CONTEXT.md CONTEXT.md`
- `git mv .ralph/VISION.md VISION.md`
- `git mv .ralph/docs/adr docs/adr` (note: this preserves the `docs/` directory at root since `docs/superpowers/` and `docs/harness/` already live there)

**Files (modified):**
- `AGENTS.md`

### Tasks

- [ ] **3.1: Verify `docs/` directory at root currently has only `superpowers/` and `harness/`.**

Run: `ls /Users/josu/Documents/projects/ralph-cli/docs/`
Expected: `harness  superpowers` (no `adr` yet).

- [ ] **3.2: `git mv .ralph/CONTEXT.md CONTEXT.md`.**

```bash
git mv .ralph/CONTEXT.md CONTEXT.md
```

- [ ] **3.3: `git mv .ralph/VISION.md VISION.md`.**

```bash
git mv .ralph/VISION.md VISION.md
```

- [ ] **3.4: `git mv .ralph/docs/adr docs/adr`.**

```bash
git mv .ralph/docs/adr docs/adr
```

- [ ] **3.5: Verify `.ralph/docs/` is empty after the move; remove if so.**

```bash
ls .ralph/docs/         # expected: empty
rmdir .ralph/docs       # safe; only removes if empty
```

- [ ] **3.6: Update `AGENTS.md` line 17.**

```
.ralph/docs/adr/0001-...
   ↓
docs/adr/0001-...
```

- [ ] **3.7: Local grep sweep — third-party convention paths gone from `.ralph/`.**

```bash
grep -rn '\.ralph/CONTEXT\.md\|\.ralph/VISION\.md\|\.ralph/docs/adr' \
  src/ pipelines/ AGENTS.md README.md \
  --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null
```
Expected: hits only in README.md (chunk 5 will fix) and `pipelines/illumination-to-implementation/verifier.md` if not already touched (chunk 2 fixed it). No hits under `src/`. AGENTS.md:17 should already be flipped by step 3.6.

- [ ] **3.8: Run full test suite + tsc.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. Tests don't reference ralph-cli's own CONTEXT.md/VISION.md/ADR files (init tests use temp dirs); the move is invisible to runtime code.

- [ ] **3.9: Verify ADR file count.**

Run: `ls docs/adr/ | wc -l`
Expected: `7` (ADR-0001 through ADR-0007).

- [ ] **3.10: Commit.**

```bash
git add CONTEXT.md VISION.md docs/adr/ AGENTS.md
git add -u .ralph/CONTEXT.md .ralph/VISION.md .ralph/docs   # tracks the moved-from sources
git status                                                  # confirm renames recognised, no stray files
git commit -m "refactor: revert CONTEXT.md, VISION.md, docs/adr/ to repo root

Third-party conventions (DDD glossary, MADR ADRs, generic project
docs) belong at repo root where the wider ecosystem expects them.
ADR-0007 had over-claimed these into .ralph/; ADR-0008 (next chunk)
documents the partition principle.

AGENTS.md:17 reference flipped."
```

---

## Chunk 4: Move ralph-defined dirs into `.ralph/`

Goal: complete ADR-0007's incomplete migration. Root `pipelines/illumination-to-implementation/` → `.ralph/pipelines/`; root `pipelines/smoke/` → `.ralph/scenarios/`; root `memory/` → `.ralph/sessions/`. Test path constants update atomically with the moves.

**Files (moved):**
- `git mv pipelines/illumination-to-implementation .ralph/pipelines/illumination-to-implementation`
- `git mv pipelines/smoke .ralph/scenarios`
- `git mv memory .ralph/sessions`

**Files (modified):**
- `src/attractor/tests/illumination-pipeline-flow.test.ts`
- `src/attractor/tests/dual-parser.test.ts`
- `src/cli/tests/pipeline-smoke-conditional-folder.test.ts`
- `src/cli/tests/pipeline-smoke-chat-only-folder.test.ts`
- `src/cli/tests/pipeline-smoke-missing-caller-var-folder.test.ts`
- `src/cli/tests/pipeline-smoke-tool-folder.test.ts`
- `src/cli/tests/pipeline-smoke-agent-json-vars-folder.test.ts`
- `src/cli/tests/pipeline-smoke-chat-end-to-end-folder.test.ts`
- `src/cli/tests/pipeline-smoke-tool-runtime-vars-folder.test.ts`
- `src/cli/tests/pipeline-smoke-store-folder.test.ts`
- `src/cli/tests/pipeline-smoke-gate-folder.test.ts`
- `src/cli/tests/pipeline-smoke-tmux-tester-folder.test.ts`
- `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts`
- `src/cli/tests/pipeline-smoke-json-schema-stream-folder.test.ts`
- `src/cli/tests/pipeline-smoke-static-multi-node-folder.test.ts`
- `src/cli/tests/pipeline-smoke-agent-implement-folder.test.ts`

### Tasks

- [ ] **4.1: `git mv pipelines/illumination-to-implementation/ .ralph/pipelines/illumination-to-implementation/`.**

```bash
mkdir -p .ralph/pipelines
git mv pipelines/illumination-to-implementation .ralph/pipelines/illumination-to-implementation
```

- [ ] **4.2: `git mv pipelines/smoke/ .ralph/scenarios/`.**

```bash
git mv pipelines/smoke .ralph/scenarios
```

- [ ] **4.3: Verify root `pipelines/` is empty; remove if so.**

```bash
ls pipelines/         # expected: empty
rmdir pipelines       # safe; only removes if empty
```

- [ ] **4.4: `git mv memory/ .ralph/sessions/`.**

Note: `.ralph/sessions/` doesn't exist yet (created lazily by chunk 1's `init.ts` only when `ralph init` runs). Need to ensure target parent exists.

```bash
git mv memory .ralph/sessions
```

If `git mv` complains about `.ralph/sessions` not existing as a parent: that's expected since `.ralph/` exists but `.ralph/sessions/` does not. The `git mv <src> <dest>` form treats `<dest>` as the new name. Verify with `ls .ralph/sessions/` after — should contain 18 .md files.

- [ ] **4.5: Remove empty `.ralph/memory/` if it exists.**

```bash
ls .ralph/memory/    # expected: empty (chunk 1 made init.ts not create it, but for ralph-cli's own .ralph/ the dir was created by past ralph init)
rmdir .ralph/memory  # safe
```

- [ ] **4.6: Update `illumination-pipeline-flow.test.ts:8-9`.**

```typescript
// Before:
const dotPath = resolve(root, "pipelines/illumination-to-implementation/pipeline.dot");
const dotDir = resolve(root, "pipelines/illumination-to-implementation");

// After:
const dotPath = resolve(root, ".ralph/pipelines/illumination-to-implementation/pipeline.dot");
const dotDir = resolve(root, ".ralph/pipelines/illumination-to-implementation");
```

- [ ] **4.7: Update `dual-parser.test.ts:16`.**

```typescript
// Before:
const roots = ["pipelines", "pipelines/smoke"];

// After:
const roots = [".ralph/pipelines", ".ralph/scenarios"];
```

- [ ] **4.8: Update each of the 14 `pipeline-smoke-*-folder.test.ts` files — ~4 edit sites per file.**

**Important:** each file has FOUR substitutions, not one. Sample structure (from `pipeline-smoke-tool-folder.test.ts`, similar across all 14):

```typescript
// Line 8  — describe(...) string with literal path:
describe("pipelines/smoke/tool/ — chunk-4 per-folder migration", () => {

// Line 9  — it(...) string with literal path:
  it("pipeline.dot exists at <repo>/pipelines/smoke/tool/pipeline.dot", () => {

// Line 10 — join(...) array form:
    const expected = join(REPO_ROOT, "pipelines", "smoke", "tool", "pipeline.dot");

// Line 15 — second join(...) call inside a different `it` block:
    const dotPath = join(REPO_ROOT, "pipelines", "smoke", "tool", "pipeline.dot");
```

Replacements (apply all four to each file; `<subdir>` is the per-file directory name like `tool`, `conditional`, `chat-only`, etc.):

```typescript
// describe + it strings:
"pipelines/smoke/<subdir>/" → ".ralph/scenarios/<subdir>/"
"<repo>/pipelines/smoke/<subdir>/pipeline.dot" → "<repo>/.ralph/scenarios/<subdir>/pipeline.dot"

// join(...) array forms (both occurrences per file):
join(REPO_ROOT, "pipelines", "smoke", "<subdir>", ...)
   → join(REPO_ROOT, ".ralph", "scenarios", "<subdir>", ...)
```

Process: for each of the 14 files, read the file once, list the line numbers containing `pipelines` `smoke` (string-literal or array-arg), apply substitutions, save. The 14 files (subdir per file is the trailing token before `-folder.test.ts`):

`conditional`, `chat-only`, `missing-caller-var`, `tool`, `agent-json-vars`, `chat-end-to-end`, `tool-runtime-vars`, `store`, `gate`, `tmux-tester`, `meditate-steer`, `json-schema-stream`, `static-multi-node`, `agent-implement`.

After all 14 files updated, verify:

```bash
grep -rn 'pipelines/smoke\|"pipelines",\s*"smoke"' src/cli/tests/ src/attractor/tests/
```
Expected: zero hits. (Pattern catches both string-literal forms and array-arg forms.)

- [ ] **4.9: Run all four kinds of tests.**

```bash
npx vitest run src/attractor/tests/illumination-pipeline-flow.test.ts
npx vitest run src/attractor/tests/dual-parser.test.ts
npx vitest run src/cli/tests/pipeline-smoke-
npx vitest run    # full suite
```

Expected: all PASS.

- [ ] **4.10: Run smoke verification of pipeline list.**

```bash
npx ralph pipeline list .
```

Expected: `illumination-to-implementation` appears; nothing under `.ralph/scenarios/` is listed (subdirs invisible to top-level scan, per spec §3.3).

- [ ] **4.11: Commit.**

```bash
git add .ralph/ src/attractor/tests/illumination-pipeline-flow.test.ts \
        src/attractor/tests/dual-parser.test.ts \
        src/cli/tests/pipeline-smoke-*-folder.test.ts \
        pipelines/ memory/    # the moved-from sources
git status              # confirm move-pairs are tracked as renames
git commit -m "refactor: complete .ralph/ migration of ralph-defined artefacts

- pipelines/illumination-to-implementation → .ralph/pipelines/...
- pipelines/smoke → .ralph/scenarios (renamed: smoke fixtures are
  test scenarios, not production pipelines; commingling them under
  .ralph/pipelines would pollute pipeline list).
- memory → .ralph/sessions (renamed: 'memory' is overloaded across
  Claude auto-memory, ADR-0007's empty slot, and session-closure
  files; sessions describes what the dir holds).
- Drop empty .ralph/memory/.

Test path constants for 14 smoke-folder tests, illumination-flow
test, and dual-parser test updated atomically with the moves."
```

---

## Chunk 5: Doc updates — `README.md`, `CONTEXT.md`, `VISION.md`

Goal: README reflects the partial-revert layout. CONTEXT.md (now at root) is rewritten to document the partition principle, the new `.ralph/sessions/` and `.ralph/scenarios/` slots, and the split "Harness scenario" / "Smoke-pipeline scenario" glossary entries. VISION.md narrative updates to describe the partition.

**Files:**
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `VISION.md`

### Tasks

- [ ] **5.1: Update `README.md` line 14 (init description).**

```
Before:
`ralph init` is idempotent. It creates `.ralph/{pipelines,meditations/{illuminations,stimuli},memory,docs/adr}`, scaffolds empty `VISION.md` and `CONTEXT.md`, ...

After:
`ralph init` is idempotent. It creates `.ralph/{pipelines,meditations/{illuminations,stimuli},sessions,runs}` plus root `docs/adr/`, scaffolds empty `VISION.md`, `CONTEXT.md`, and `README.md` at repo root, ...
```

- [ ] **5.2: Update `README.md` line 37.**

```
documented in `.ralph/CONTEXT.md` and `.ralph/docs/adr/0003-...`
   ↓
documented in `CONTEXT.md` and `docs/adr/0003-...`
```

- [ ] **5.3: Update `README.md` line 61.**

```
See `.ralph/docs/adr/0002-...`
   ↓
See `docs/adr/0002-...`
```

- [ ] **5.4: Update `README.md` lines 170-173 ("Where to look" section).**

```
- **`.ralph/CONTEXT.md`** — domain language and glossary
- **`.ralph/docs/adr/`** — decision records
   ↓
- **`CONTEXT.md`** — domain language and glossary
- **`docs/adr/`** — decision records (why things are the way they are)
```

- [ ] **5.5: Delete `README.md` lines 184-198 (migration recipe).**

The "Migrating an existing ralph project to the .ralph/ layout" section described migrating *into* the ADR-0007 layout that this revert undoes. No projects need it; deletion is cleaner than rewriting. Delete the section header (line 184) through the post-recipe paragraph (line 198 — the "~/.ralph/<projectKey>/runs/" inert-dir note).

- [ ] **5.6: Update `README.md` line 202.**

```
See [`.ralph/docs/adr/`](.ralph/docs/adr/) for accepted decision records.
   ↓
See [`docs/adr/`](docs/adr/) for accepted decision records.
```

- [ ] **5.7: Multi-section rewrite of `CONTEXT.md` (now at repo root).**

Read the file end-to-end first. Then apply:

(a) **Layout diagram** (~lines 26-34). Update the `.ralph/` tree:
```
.ralph/
├── pipelines/
├── meditations/
│   ├── illuminations/
│   └── stimuli/
├── sessions/                ← was memory
├── scenarios/               ← new (smoke-pipeline fixtures)
└── runs/
```
And add a sibling note: `<repo root>/CONTEXT.md, VISION.md, docs/adr/, README.md` — pre-existing project-doc conventions.

(b) **Inline self-references** to flip (lines listed):
- Line 15: `.ralph/docs/adr/0001-...` → `docs/adr/0001-...`
- Line 40: `.ralph/docs/adr/0007-...` → `docs/adr/0007-...`
- Line 70: `.ralph/docs/adr/0002-...` → `docs/adr/0002-...`
- Line 136: `.ralph/docs/adr/` → `docs/adr/`
- Line 145: `.ralph/docs/adr/0004-...` → `docs/adr/0004-...`
- Line 148: `.ralph/CONTEXT.md` → `CONTEXT.md`; `.ralph/docs/adr/` → `docs/adr/`

**Do NOT flip** lines pointing at `.ralph/meditations/illuminations/` (lines 23, 46, 65, 72), `.ralph/pipelines/` (lines 23, 34), or `~/.ralph/agents/` (lines 17, 20). Those stay.

(c) **Glossary split.** The existing "Scenario test" entry defines scenarios as harness fixtures. Split into:
- **"Harness scenario"** — operator-surface markdown driven by tmux-tester; lives at `src/tests/scenarios/`. Cross-ref: see "Smoke-pipeline scenario."
- **"Smoke-pipeline scenario"** — pipeline-engine test fixture (`.dot` + agent `.md` with ralph-specific frontmatter); lives at `.ralph/scenarios/`; consumed by `pipeline-smoke-*-folder.test.ts`. Cross-ref: see "Harness scenario."

(d) **New glossary entries.**
- **"Session-closure file"** — markdown narrative written by the `memory-writer` pipeline node at the end of each illumination-implementation session; lives at `.ralph/sessions/<date>-<slug>.md`. Replaces the prior loose use of "session memory."
- **"Project-local artefact"** — file or directory matching the §1.2 two-clause rule (ralph-defined AND no pre-existing root convention); belongs in `<project>/.ralph/`. Cross-ref ADR-0007 + ADR-0008.

(e) **ADR supersession footer.**
At end of file (or natural section break): "ADR-0007 (`.ralph/` as project-local home) is partly superseded by ADR-0008 (partial revert + partition principle). See `docs/adr/0008-partial-revert-of-ralph-folder.md`."

- [ ] **5.8: Update `VISION.md` line 30 + line 32 (post-`git mv`, now at repo root).**

Line 30 narrative: replace the sentence that says `.ralph/` is "the single home for everything ralph-touchable in the project: pipelines, meditations …, memory, ADRs, CONTEXT.md, VISION.md, run state" with:

> A target project declares itself ralph-shaped by having a `.ralph/` folder. That folder holds ralph-defined project-local artefacts: pipelines, meditations (illuminations + stimuli), sessions (closure files written by `memory-writer`), scenarios (smoke-pipeline test fixtures), and run state. Project-doc conventions owned by the wider ecosystem — `CONTEXT.md`, `VISION.md`, `docs/adr/`, `README.md` — stay at repo root where humans, IDE doc-outliners, and third-party tooling expect them.

Line 32:
```
See `.ralph/docs/adr/0007-ralph-folder-as-project-local-home.md` for the full layout.
   ↓
See `docs/adr/0007-ralph-folder-as-project-local-home.md` (and the partial-revert refinement in `docs/adr/0008-partial-revert-of-ralph-folder.md`) for the layout and partition principle.
```

- [ ] **5.9: Run grep sweep.**

```bash
grep -rn '\.ralph/CONTEXT\.md\|\.ralph/VISION\.md\|\.ralph/docs/adr' \
  README.md CONTEXT.md VISION.md AGENTS.md src/ pipelines/ \
  --exclude-dir=node_modules --exclude-dir=dist
```
Expected: zero hits in live files (historical plans/specs under `docs/superpowers/` are exempt).

- [ ] **5.10: Run full test suite.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **5.11: Commit.**

```bash
git add README.md CONTEXT.md VISION.md
git commit -m "docs: align README/CONTEXT/VISION with partial-revert layout

README: drop migration recipe (no projects need it); flip
inline .ralph/CONTEXT.md and .ralph/docs/adr/ refs to root.

CONTEXT: layout diagram + inline self-refs flip; glossary
splits Scenario test into Harness scenario + Smoke-pipeline
scenario; new entries Session-closure file + Project-local
artefact (the partition principle).

VISION: narrative reflects ralph-defined-vs-pre-existing
partition; ADR-0008 cross-reference."
```

---

## Chunk 6: Write ADR-0008 + ADR-0007 footer

Goal: capture the decision in the ADR system. ADR-0008 defines the partition principle (§1.2 two-clause rule from spec) and explicitly supersedes the relevant clauses of ADR-0007. ADR-0007 receives a one-line pointer footer.

**Files:**
- Create: `docs/adr/0008-partial-revert-of-ralph-folder.md`
- Modify: `docs/adr/0007-ralph-folder-as-project-local-home.md`

### Tasks

- [ ] **6.1: Read ADR-0007 to understand its structure.**

Read `docs/adr/0007-ralph-folder-as-project-local-home.md`. Note its sections (Status, Context, Decision, Consequences, etc.) and the layout-tree block in Decision.

- [ ] **6.2: Read 1-2 prior ADRs (e.g. 0001, 0002) to mirror style.**

The repo's ADR style: short Markdown, MADR-ish. Match heading levels and prose voice.

- [ ] **6.3: Write `docs/adr/0008-partial-revert-of-ralph-folder.md`.**

When writing the "Supersedes (in part)" section, **quote the verbatim layout-tree fragment** from ADR-0007's Decision section (the lines showing `.ralph/CONTEXT.md`, `.ralph/VISION.md`, `.ralph/docs/adr/`, `.ralph/memory/`). Per spec §2 item 7, the supersession must reference specific lines, not just describe them.

Skeleton:

```markdown
# 0008 — Partial Revert of ADR-0007: Restore Third-Party Convention Files to Repo Root

**Status:** Accepted (2026-05-04)

**Supersedes (in part):** ADR-0007. Specifically, the layout-tree clauses placing `CONTEXT.md`, `VISION.md`, `docs/adr/`, and the unused `memory/` slot under `.ralph/`. The remainder of ADR-0007 (project-local pipelines, meditations, run state, the two-tier resolver) stands.

## Context

ADR-0007 (one week prior) introduced `<project>/.ralph/` as "the home for everything ralph-touchable." Operational evidence accumulated within days of dogfooding revealed an over-claim: third-party skills (`grill-with-docs`, `improve-codebase-architecture`) hard-code `CONTEXT.md` and `docs/adr/` at repo root by ecosystem convention. Placing these files under `.ralph/` made them invisible to skills that expect the standard layout. Two further symptoms: discoverability drop on GitHub (where outsiders browse root-level docs by default) and incomplete migration drift (root `pipelines/` and `memory/` never moved, while their `.ralph/` slots remained empty).

The principle "ralph reads it, therefore ralph owns it" does not hold. Reading a file is not the same as defining its convention.

## Decision

Adopt a **two-clause partition principle**:

A file or directory belongs in `<project>/.ralph/` only if **both**:

- **Clause A — ralph-defined.** Its format, lifecycle, or discovery semantics are specified by ralph (illumination YAML schema, `.dot` files with ralph attributes, run-state checkpoint format, etc.).
- **Clause B — no pre-existing root convention.** No widely-adopted ecosystem convention places the file at repo root (DDD glossary, MADR ADRs, generic markdown project-docs, npm `package.json`, etc.).

Both clauses are necessary. Clause A alone is too permissive (ralph parses many files). Clause B alone is too restrictive (it forbids `.ralph/` entirely). The combination is the rule.

### Concrete moves

| File | Lives at |
|------|----------|
| `CONTEXT.md`, `VISION.md` | repo root (clause B fails: pre-existing project-doc conventions) |
| `docs/adr/` | repo root (clause B fails: MADR convention) |
| `.ralph/pipelines/` | inside `.ralph/` (both clauses) |
| `.ralph/meditations/{illuminations,stimuli}/` | inside `.ralph/` (both clauses) |
| `.ralph/sessions/` | inside `.ralph/` (both clauses; renamed from "memory" — overloaded term) |
| `.ralph/scenarios/` | inside `.ralph/` (both clauses; smoke-pipeline test fixtures) |
| `.ralph/runs/` | inside `.ralph/` (both clauses; unchanged from ADR-0007) |

### Deprecated from ADR-0007

The `.ralph/memory/` slot is removed. Session-closure files written by the `memory-writer` pipeline node now land at `.ralph/sessions/`. The `memoryDir()` helper in `ralph-paths.ts` is renamed `sessionsDir()`. The `docsAdrDir()` helper is deleted; ADR paths use root `docs/adr/`.

## Consequences

**Positive:**
- Third-party skills land correctly at root-conventional paths.
- GitHub/IDE doc-outliners surface project docs by default.
- Operational test exists for future placement decisions; reduces re-litigation risk.

**Negative:**
- Reverses an accepted ADR within one week. Sets a precedent that ADRs encode best-understanding-at-time and update with new operational evidence. Mitigated by the append-only ADR convention: ADR-0007's body stays unchanged; ADR-0008 supersedes by reference.
- Dual locations for project content (`.ralph/` for ralph-defined, root for pre-existing conventions) require operators to learn the partition. The §Decision table is the reference.

**Out of scope (preserved from ADR-0007):**
- Project-local pipelines as a tier (`.ralph/pipelines/` overrides bundled).
- Run-state inside `.ralph/runs/` (no user-home tier).
- `~/.ralph/agents/` rejected (per ADR-0001).

## Alternatives considered and rejected

- **`CONTEXT-MAP.md` at root pointing into `.ralph/`.** Documented escape hatch in the skill ecosystem. Rejected: only fixes the primary skill, leaves humans + IDE outliners + secondary tools unhelped; codifies the over-claim instead of correcting it.
- **Patch the skills to look at `.ralph/CONTEXT.md` first.** Rejected: global blast radius (every project on the machine), bus-factor (collaborators on fresh machines silently fall back), sibling-skill drift (each doc-aware skill needs its own patch).
- **Symlinks.** Rejected: platform-fragile; doesn't match what humans see in GitHub UI.

## References

- ADR-0007: `.ralph/` as project-local home for ralph-touchable state.
- Spec: `docs/superpowers/specs/2026-05-04-ralph-folder-partial-revert-design.md` — full design and operational test.
- Plan: `docs/superpowers/plans/2026-05-04-ralph-folder-partial-revert.md` — implementation plan.
```

- [ ] **6.4: Add ADR-0007 footer.**

Append at end of `docs/adr/0007-ralph-folder-as-project-local-home.md`:

```markdown

---

**Update 2026-05-04:** Partly superseded by [ADR-0008](0008-partial-revert-of-ralph-folder.md). The clauses of this ADR placing `CONTEXT.md`, `VISION.md`, `docs/adr/`, and the unused `memory/` slot under `.ralph/` are reversed; the remainder (project-local pipelines, meditations, run state, two-tier resolver) stands.
```

- [ ] **6.5: Run `grep -rn` sanity check.**

```bash
grep -rn 'ADR-0008\|0008-partial-revert' docs/adr/ CONTEXT.md VISION.md README.md
```

Expected: hits in ADR-0007 footer (one), ADR-0008 file (multiple, self-references), CONTEXT.md (the supersession footer added in chunk 5), VISION.md (line 32 reference). Cross-references coherent.

- [ ] **6.6: Run full test suite.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **6.7: Commit.**

```bash
git add docs/adr/0008-partial-revert-of-ralph-folder.md \
        docs/adr/0007-ralph-folder-as-project-local-home.md
git commit -m "docs(adr): ADR-0008 — partial revert of ADR-0007

Documents the two-clause partition principle (ralph-defined AND
no pre-existing root convention) and supersedes the layout-tree
clauses of ADR-0007 that placed CONTEXT.md, VISION.md, docs/adr/,
and the unused memory/ slot under .ralph/.

ADR-0007 footer points readers at ADR-0008."
```

---

## Chunk 7: Cleanup + smoke verification + skill landing check

Goal: stale doc deletion, full smoke pass, empirical skill-landing verification (the original motivation).

**Files:**
- Delete: `IMPLEMENTATION_PLAN.md`

### Tasks

- [ ] **7.1: Verify `.ralph/memory/` is gone (chunk 4 should have removed).**

```bash
test -d .ralph/memory && echo "still exists; rmdir" || echo "gone"
```

If still exists: `rmdir .ralph/memory`. Should be empty.

- [ ] **7.2: Delete `IMPLEMENTATION_PLAN.md`.**

```bash
git rm IMPLEMENTATION_PLAN.md
```

- [ ] **7.3: Final grep sweep — partition principle invariants.**

```bash
# No ralph-defined paths leaked to root:
grep -rn '"\\?meditations/illuminations\\|"\\?meditations/stimuli\\|"\\?\\.\\?/runs/' \
  src/ pipelines/ --exclude-dir=node_modules --exclude-dir=dist | grep -v '\\.ralph'
# Expected: zero hits (all references go through ralph-paths.ts).

# No third-party-convention paths still under .ralph/:
grep -rn '\\.ralph/CONTEXT\\.md\\|\\.ralph/VISION\\.md\\|\\.ralph/docs/adr' \
  src/ pipelines/ README.md AGENTS.md CONTEXT.md VISION.md docs/adr/ \
  --exclude-dir=node_modules --exclude-dir=dist
# Expected: zero live hits. Historical hits in docs/superpowers/plans/specs/ exempt.

# memoryDir / docsAdrDir gone from src/:
grep -rn '\\bmemoryDir\\b\\|\\bdocsAdrDir\\b' src/
# Expected: zero hits.
```

- [ ] **7.4: Build verification.**

```bash
npm run build
```

Expected: PASS. tsup re-bundles `dist/cli/index.js` etc. with the new help-text strings.

- [ ] **7.5: Smoke — `ralph init` in a temp dir.**

```bash
TMPDIR=$(mktemp -d /tmp/ralph-init-test.XXXXXX)
cd "$TMPDIR"
node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js init
ls -la                                # expect: CONTEXT.md, VISION.md, README.md, .ralph/, docs/, .gitignore
ls -la .ralph/                        # expect: pipelines/, meditations/, sessions/, runs/ (lazy or eager)
ls docs/                              # expect: adr/
cat .gitignore                        # expect: contains .ralph/runs/
cd /Users/josu/Documents/projects/ralph-cli
rm -rf "$TMPDIR"
```

Expected: all assertions hold.

- [ ] **7.6: Smoke — `ralph init` idempotent.**

Same temp dir flow but run `ralph init` twice. Confirm no overwrites of empty files re-scaffolded with custom content.

- [ ] **7.7: Smoke — `ralph pipeline list .` from repo root.**

```bash
node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js pipeline list .
```

Expected: lists `illumination-to-implementation` (the only top-level `.dot` under `.ralph/pipelines/`); does NOT list anything from `.ralph/scenarios/` (subdirs invisible).

- [ ] **7.7b: (optional) Smoke — `ralph pipeline run` against the moved illumination pipeline.**

Per spec §10.3, run the relocated pipeline end-to-end as a final integration check. Heavy operation (drives multiple agent invocations), so optional and flagged.

```bash
node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js \
  pipeline run .ralph/pipelines/illumination-to-implementation/pipeline.dot \
  --project /Users/josu/Documents/projects/ralph-cli
```

Expected: pipeline resolves, run state writes to `.ralph/runs/<runId>/`, no path-related errors. Skip if no fresh illumination is available to consume.

- [ ] **7.8: Empirical skill-landing check (the original motivation).**

```bash
# Confirm the skill ecosystem hard-codes root paths:
grep -rn 'CONTEXT\\.md\\|docs/adr' \
  ~/.claude/skills/grill-with-docs/ \
  ~/.claude/skills/improve-codebase-architecture/ 2>/dev/null | head -20

# Confirm both files now exist at root:
test -f CONTEXT.md && echo "CONTEXT.md at root: ✓" || echo "MISSING"
test -d docs/adr && echo "docs/adr at root: ✓" || echo "MISSING"
ls docs/adr/ | wc -l                  # expect: 8 (ADRs 0001-0008)
```

Expected: skill files reference root paths; both targets exist.

- [ ] **7.9: Optional — manual `/grill-with-docs` invocation.**

In a fresh Claude Code session at the repo root, invoke `/grill-with-docs` against any topic. Confirm the skill discovers `CONTEXT.md` and `docs/adr/` without complaint. Record the session result in this plan's verification section if convenient.

- [ ] **7.10: Final full test run.**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: PASS, full green.

- [ ] **7.11: Commit cleanup.**

```bash
git add -u                           # picks up IMPLEMENTATION_PLAN.md deletion + .ralph/memory/ rmdir tracking
git commit -m "chore: drop stale IMPLEMENTATION_PLAN.md + remove empty .ralph/memory/

IMPLEMENTATION_PLAN.md was the executed plan for ADR-0007's
original migration; every reference inside it is to a layout
this revert undoes. Git history preserves it.

.ralph/memory/ slot deprecated by ADR-0008; session-closure files
now live in .ralph/sessions/."
```

---

## Verification — overall

After all 7 chunks:

- `git log --oneline -10` shows 7 commits in order: code edits, pipeline prompts, root-convention moves, ralph-defined moves, doc updates, ADR-0008, cleanup.
- `npx tsc --noEmit` passes.
- `npx vitest run` passes.
- `npm run build` passes.
- `ralph init` in a temp dir scaffolds the partial-revert layout.
- `ralph pipeline list .` lists `illumination-to-implementation` and not the smoke scenarios.
- `grep -rn '\\bmemoryDir\\|docsAdrDir' src/` returns zero hits.
- `grep -rn '\\.ralph/CONTEXT\\|\\.ralph/VISION\\|\\.ralph/docs/adr' src/ pipelines/ README.md CONTEXT.md VISION.md AGENTS.md` returns zero hits.
- Third-party doc-aware skills land correctly at root paths.

---

## Rollback notes

If any chunk fails verification:

- **Chunks 1–4** are independently revertable via `git revert <sha>`. The next chunk's commit may need a fix-up but the partition principle isn't violated.
- **Chunks 5–7** are doc/ADR/cleanup; revertable without test impact.
- The hardest revert window is between chunks 3 and 4 — `.ralph/CONTEXT.md` is gone but root `pipelines/` and `memory/` haven't moved yet. The repo is functional but mid-state. Don't pause work for >1 day in that window.

If a critical bug surfaces post-merge: roll forward by adjusting the next ADR (0009+) rather than reverting 0008. The ADR trail must remain append-only.
