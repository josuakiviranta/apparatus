# Relocate Operator Scenarios Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move three operator-scenario `.md` files from `src/tests/scenarios/` to `.apparat/scenarios/` (root), update five non-historical text references, widen the doc gloss, and delete the empty `src/tests/` tree.

**Architecture:** Pure relocation + path-string update. No code logic changes. The destination `.apparat/scenarios/` already holds 15 pipeline-smoke-fixture subdirectories; bare `.md` files at root coexist because three existing filters (tmux-tester glob `*/pipeline.dot`, per-folder smoke tests, `dual-parser.test.ts` `.endsWith(".dot")`) only match subdirs.

**Tech Stack:** git, ripgrep, vitest, apparat CLI.

**Spec:** `docs/superpowers/specs/2026-05-07-relocate-operator-scenarios-design.md`

---

## File Structure

**Move (history-preserving via `git mv`):**
- `src/tests/scenarios/apparat-init-idempotent.md` → `.apparat/scenarios/apparat-init-idempotent.md`
- `src/tests/scenarios/apparat-init-scaffolds-tree.md` → `.apparat/scenarios/apparat-init-scaffolds-tree.md`
- `src/tests/scenarios/pipeline-list-reads-apparat-pipelines-dir.md` → `.apparat/scenarios/pipeline-list-reads-apparat-pipelines-dir.md`

**Delete (after move):**
- `src/tests/scenarios/` (empty)
- `src/tests/` (now empty)

**Modify:**
- `CONTEXT.md` — line 100 path; append cross-ref sentence in the existing "Harness scenario" entry
- `VISION.md` — line 32 widen "scenarios" gloss
- `src/cli/skills/apparatus/pipelines.md` — line 377 example value
- `src/cli/program.ts` — line 82 help-text example
- `src/cli/pipelines/implement/scenario-author.md` — line 120 example output string
- `src/cli/tests/implement.test.ts` — three string occurrences (lines 69, 73, 89)

**Untouched (verified in spec):**
- `docs/adr/0003-scenario-tests-in-implement-pipeline.md` line 189 (historical artefact, ADR convention)
- All 15 pipeline-smoke-fixture subdirectories under `.apparat/scenarios/`
- All 11 `pipeline-smoke-*-folder.test.ts` files
- `tmux-tester.md` glob pattern

---

## Chunk 1: Move, update references, verify, commit

### Task 1: Snapshot the pre-state

**Files:** none modified.

- [x] **Step 1: Capture the reference inventory**

Run from repo root:

```bash
grep -rn "src/tests/scenarios" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.git \
  --exclude-dir=docs/superpowers/plans \
  --exclude-dir=docs/superpowers/specs \
  .
```

Expected: exactly 8 hits across 6 files:
- `CONTEXT.md:100`
- `docs/adr/0003-scenario-tests-in-implement-pipeline.md:189` (historical, will not be edited)
- `src/cli/skills/apparatus/pipelines.md:377`
- `src/cli/program.ts:82`
- `src/cli/pipelines/implement/scenario-author.md:120`
- `src/cli/tests/implement.test.ts:69, 73, 89` (3 hits)

If the count differs from 8, **stop** and reconcile with the spec inventory before editing.

---

### Task 2: Physically relocate the three files

**Files:**
- Move: `src/tests/scenarios/apparat-init-idempotent.md` → `.apparat/scenarios/apparat-init-idempotent.md`
- Move: `src/tests/scenarios/apparat-init-scaffolds-tree.md` → `.apparat/scenarios/apparat-init-scaffolds-tree.md`
- Move: `src/tests/scenarios/pipeline-list-reads-apparat-pipelines-dir.md` → `.apparat/scenarios/pipeline-list-reads-apparat-pipelines-dir.md`

- [x] **Step 1: Move with git to preserve history**

```bash
git mv src/tests/scenarios/apparat-init-idempotent.md            .apparat/scenarios/apparat-init-idempotent.md
git mv src/tests/scenarios/apparat-init-scaffolds-tree.md        .apparat/scenarios/apparat-init-scaffolds-tree.md
git mv src/tests/scenarios/pipeline-list-reads-apparat-pipelines-dir.md .apparat/scenarios/pipeline-list-reads-apparat-pipelines-dir.md
```

- [x] **Step 2: Verify destination layout**

```bash
ls .apparat/scenarios/*.md
```

Expected (alphabetical):

```
.apparat/scenarios/apparat-init-idempotent.md
.apparat/scenarios/apparat-init-scaffolds-tree.md
.apparat/scenarios/pipeline-list-reads-apparat-pipelines-dir.md
```

- [x] **Step 3: Verify pipeline-smoke subdirs untouched**

```bash
ls -d .apparat/scenarios/*/ | wc -l
```

Expected: `15`.

- [x] **Step 4: Remove the empty source tree**

```bash
rmdir src/tests/scenarios
rmdir src/tests
```

Both must succeed (empty). If `src/tests/` contains anything else, **stop** — surface to operator (the spec assumed `scenarios/` was the only child).

---

### Task 3: Update `CONTEXT.md`

**Files:**
- Modify: `CONTEXT.md:100` (path)
- Modify: `CONTEXT.md` "Harness scenario" entry (append one sentence)

- [x] **Step 1: Replace the path on line 100**

Find:

```
A markdown file (typically under `src/tests/scenarios/` in a target project)
```

Replace with:

```
A markdown file (typically under `.apparat/scenarios/` in a target project)
```

- [x] **Step 2: Append cross-reference sentence inside the "Harness scenario" entry**

Find the line that currently ends the entry just before `### Smoke-pipeline scenario`:

```
See also: **Smoke-pipeline scenario**.
```

Replace with:

```
Co-located under `.apparat/scenarios/` — operator scenarios at root, smoke fixtures in subdirs.

See also: **Smoke-pipeline scenario**.
```

(Adds one paragraph above the `See also:` line; do not duplicate the cross-ref.)

---

### Task 4: Update `VISION.md` line 32

**Files:**
- Modify: `VISION.md:32`

- [x] **Step 1: Widen the "scenarios" gloss**

Find:

```
sessions (closure files written by `memory-writer`), scenarios (smoke-pipeline test fixtures), and run state.
```

Replace with:

```
sessions (closure files written by `memory-writer`), scenarios (operator scenarios + smoke-pipeline test fixtures), and run state.
```

---

### Task 5: Update `src/cli/skills/apparatus/pipelines.md` line 377

**Files:**
- Modify: `src/cli/skills/apparatus/pipelines.md:377`

- [x] **Step 1: Replace the example value**

Find:

```
| **Caller-supplied** | `--var k=v` on the CLI; declared via graph-level `inputs="k"` | `--var scenarios_dir=src/tests/scenarios` |
```

Replace with:

```
| **Caller-supplied** | `--var k=v` on the CLI; declared via graph-level `inputs="k"` | `--var scenarios_dir=.apparat/scenarios` |
```

---

### Task 6: Update `src/cli/program.ts` line 82

**Files:**
- Modify: `src/cli/program.ts:82`

- [x] **Step 1: Replace the help-text example**

Find:

```
.addHelpText("after", "\nExamples:\n  apparat implement my-app\n  apparat implement my-app --max 5\n  apparat implement my-app --max 0   # unlimited iterations\n  apparat implement my-app --scenarios src/tests/scenarios   # write & verify scenario tests (requires tmux)\n\nThe pipeline can be overridden by placing pipelines/implement.dot in your project folder.\n")
```

Replace with:

```
.addHelpText("after", "\nExamples:\n  apparat implement my-app\n  apparat implement my-app --max 5\n  apparat implement my-app --max 0   # unlimited iterations\n  apparat implement my-app --scenarios .apparat/scenarios   # write & verify scenario tests (requires tmux)\n\nThe pipeline can be overridden by placing pipelines/implement.dot in your project folder.\n")
```

---

### Task 7: Update `src/cli/pipelines/implement/scenario-author.md` line 120

**Files:**
- Modify: `src/cli/pipelines/implement/scenario-author.md:120`

- [x] **Step 1: Replace the example output string**

Find:

```
Considered 3 clusters from 8 commits. Wrote 1 new scenario (implement --scenarios flag), skipped 2 (1 subsumed by apparat-implement-baseline.md, 1 infeasible — pure refactor of agent-loader). Files touched: src/tests/scenarios/implement-with-scenarios-flag.md.
```

Replace with:

```
Considered 3 clusters from 8 commits. Wrote 1 new scenario (implement --scenarios flag), skipped 2 (1 subsumed by apparat-implement-baseline.md, 1 infeasible — pure refactor of agent-loader). Files touched: .apparat/scenarios/implement-with-scenarios-flag.md.
```

---

### Task 8: Update `src/cli/tests/implement.test.ts` (3 sites)

**Files:**
- Modify: `src/cli/tests/implement.test.ts:69, 73, 89`

- [x] **Step 1: Replace all three occurrences in one pass**

Use `replace_all` semantics (the literal string occurs only in this test file, in three lines).

Find (literal, all occurrences):

```
src/tests/scenarios
```

Replace with:

```
.apparat/scenarios
```

After the edit, lines 69 / 73 / 89 should read:

```ts
await implementCommand("/my/project", { scenarios: ".apparat/scenarios" });
```

```ts
variables: expect.objectContaining({ scenarios_dir: ".apparat/scenarios" }),
```

```ts
implementCommand("/my/project", { scenarios: ".apparat/scenarios" })
```

- [x] **Step 2: Run the test file in isolation to confirm green**

```bash
npx vitest run src/cli/tests/implement.test.ts
```

Expected: all tests pass. (The fixture pins the variable forwarding; new string forwards correctly under both tmux-set and tmux-unset branches.)

---

### Task 9: Verify acceptance gates

**Files:** none modified.

- [x] **Step 1: Confirm zero non-historical references remain**

```bash
grep -rn "src/tests/scenarios" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.git \
  --exclude-dir=docs/superpowers/plans \
  --exclude-dir=docs/superpowers/specs \
  .
```

Expected: exactly **one hit**:
- `docs/adr/0003-scenario-tests-in-implement-pipeline.md:189` (historical)

Any other hit means an edit was missed — **stop** and reconcile.

- [x] **Step 2: Confirm `src/tests/` no longer exists**

```bash
ls src/tests 2>&1 | head -2
```

Expected: `ls: src/tests: No such file or directory`.

- [x] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: green. The pipeline-smoke suite is unaffected (untouched paths); `implement.test.ts` is the only test that changed shape.

- [x] **Step 4: Validate one smoke-fixture pipeline still validates**

```bash
npx tsx src/cli/index.ts pipeline validate .apparat/scenarios/conditional/pipeline.dot
```

Expected: validator prints the success line (no `error:` diagnostics). Confirms smoke fixtures are unaffected.

- [x] **Step 5: Confirm the new operator scenarios are visible to a `--scenarios` consumer**

```bash
ls .apparat/scenarios/*.md
```

Expected: 3 files listed (the relocated scenarios).

---

### Task 10: Commit

- [x] **Step 1: Stage the changes**

```bash
git add CONTEXT.md VISION.md \
        src/cli/skills/apparatus/pipelines.md \
        src/cli/program.ts \
        src/cli/pipelines/implement/scenario-author.md \
        src/cli/tests/implement.test.ts \
        .apparat/scenarios/apparat-init-idempotent.md \
        .apparat/scenarios/apparat-init-scaffolds-tree.md \
        .apparat/scenarios/pipeline-list-reads-apparat-pipelines-dir.md
```

(The three deletions under `src/tests/` are already staged by `git mv` in Task 2; no extra `git add` needed for the directory removal.)

- [x] **Step 2: Verify the staging area**

```bash
git status
```

Expected, in order:

- `renamed: src/tests/scenarios/apparat-init-idempotent.md -> .apparat/scenarios/apparat-init-idempotent.md`
- `renamed: src/tests/scenarios/apparat-init-scaffolds-tree.md -> .apparat/scenarios/apparat-init-scaffolds-tree.md`
- `renamed: src/tests/scenarios/pipeline-list-reads-apparat-pipelines-dir.md -> .apparat/scenarios/pipeline-list-reads-apparat-pipelines-dir.md`
- `modified: CONTEXT.md`
- `modified: VISION.md`
- `modified: src/cli/pipelines/implement/scenario-author.md`
- `modified: src/cli/program.ts`
- `modified: src/cli/skills/apparatus/pipelines.md`
- `modified: src/cli/tests/implement.test.ts`

If any rename shows as `deleted + new file` instead of `renamed`, the move was not done with `git mv` — undo and redo Task 2 with `git mv`.

- [x] **Step 3: Create the commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: relocate operator scenarios from src/tests/scenarios to .apparat/scenarios

Move 3 operator-scenario markdown files (apparat-init-idempotent,
apparat-init-scaffolds-tree, pipeline-list-reads-apparat-pipelines-dir)
to .apparat/scenarios root. src/ returns to TypeScript-source-only.

Coexists with 15 pipeline-smoke-fixture subdirectories: existing tooling
filters (tmux-tester glob `*/pipeline.dot`, per-folder smoke tests, and
dual-parser.test.ts `.endsWith(".dot")`) only match subdirs, so bare
operator .md at root is invisible to all three.

Updates:
- CONTEXT.md "Harness scenario" path + cross-ref to Smoke-pipeline scenario
- VISION.md scenarios gloss widened (operator + smoke-pipeline)
- src/cli/program.ts --scenarios help-text example
- src/cli/skills/apparatus/pipelines.md --var example
- src/cli/pipelines/implement/scenario-author.md example output
- src/cli/tests/implement.test.ts fixture string (3 sites)

ADR-0003 historical body left untouched per ADR convention.

See: docs/superpowers/specs/2026-05-07-relocate-operator-scenarios-design.md
EOF
)"
```

- [x] **Step 4: Post-commit verification**

```bash
git log -1 --stat
```

Expected: the commit shows the three renames + six modifications. `src/tests/` deletion is implicit in the renames.

---

## Rollback

If any step fails irrecoverably before commit:

```bash
git restore --staged --worktree CONTEXT.md VISION.md \
  src/cli/skills/apparatus/pipelines.md \
  src/cli/program.ts \
  src/cli/pipelines/implement/scenario-author.md \
  src/cli/tests/implement.test.ts
git mv .apparat/scenarios/apparat-init-idempotent.md            src/tests/scenarios/apparat-init-idempotent.md
git mv .apparat/scenarios/apparat-init-scaffolds-tree.md        src/tests/scenarios/apparat-init-scaffolds-tree.md
git mv .apparat/scenarios/pipeline-list-reads-apparat-pipelines-dir.md src/tests/scenarios/pipeline-list-reads-apparat-pipelines-dir.md
```

After commit, rollback is `git revert <sha>`.
