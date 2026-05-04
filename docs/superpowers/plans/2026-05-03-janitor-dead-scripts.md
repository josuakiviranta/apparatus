---
---

# Janitor — Delete the Dead `scripts/` Folder Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove the unreferenced `scripts/` folder (two files + the now-empty directory) so the repo root no longer advertises a junk-drawer of dead tooling.

**Architecture:** Pure subtraction in a single atomic commit. `git rm scripts/backfill-plan-frontmatter.sh`, `git rm scripts/audit-tool-nodes.mjs`, then remove the empty `scripts/` directory from the working tree. The two file deletions are independent (no shared import — bash and Node ESM, never co-invoked) but ship together so the intermediate "empty `scripts/` folder still exists" state never lands. No code edits, no doc edits, no test edits, no `package.json` edits.

**Tech Stack:** git (deletion), bash + Node ESM (the languages of the doomed files — neither stays). Verification reuses existing tooling: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git ls-files`, ripgrep.

**Originating illumination:** `meditations/illuminations/2026-05-01T0255-janitor-dead-scripts.md`
**Design doc:** `docs/superpowers/specs/2026-05-03-janitor-dead-scripts-design.md`

---

## File Structure

This plan touches three filesystem entries, all delete-only:

| Entry | Role | Action |
|---|---|---|
| `scripts/backfill-plan-frontmatter.sh` | One-shot bash migration script. 121-line file. Hardcoded `STATUS` associative array (lines 16-65) lists 48 plan-file basenames dated 2026-04-03 → 2026-04-25. Today's `docs/superpowers/plans/` contains files dated 2026-04-30 and 2026-05-01 with zero overlap, so the guard at lines 70-72 exits 1 on the first iteration. Zero non-doc/non-self references in the repo (verified via repo-wide grep — see Task 1, Step 2). | `git rm` whole. |
| `scripts/audit-tool-nodes.mjs` | Dev-only Node ESM audit helper. 38-line file. Self-identified "Dev-only, not shipped" at lines 1-4. Zero importers, zero `package.json#scripts` bindings, zero callers from any other file (verified via repo-wide grep — see Task 1, Step 2). | `git rm` whole. |
| `scripts/` (directory) | Top-level folder. Reads as live workflow but isn't. After both files are removed it is empty. | Remove from working tree (`rmdir scripts` or via `git rm -r` semantics — note that git does not track empty directories, so the `git rm` of both files is what removes the directory from the index; the `rmdir` is purely a working-tree cleanup). |

Out of scope (locked by design §2 + verifier sizing — "pure subtraction, no surface added, no scope creep"):

- Anything under `src/`, `dist/`, `pipelines/`, `package.json`, `tsup.config.ts`, or `meditations/`.
- Editing `memory/2026-04-25-plans-have-no-lifecycle.md` — that note is the historical record of why the backfill script existed, kept as-is per design §2 / §6.
- Any change to `docs/superpowers/plans/` content (the corpus the backfill script targeted).
- Generalizing `audit-tool-nodes.mjs` into a reusable validator step. If the audit is ever needed again, the right home is `src/attractor/lib/validate-graph.ts` per design §7.2.

---

## Chunk 1: Delete both scripts and the empty folder

This chunk is the entire change. Two `git rm` calls plus a `rmdir`, all in one commit. Splitting them would produce an intermediate state where the empty `scripts/` folder still exists and continues to read as a junk drawer (constraint from design §8).

### Task 1: Baseline verification — confirm dead-code claim still holds

**Files:** None modified.

- [x] **Step 1: Capture a green baseline from the full vitest suite**

Run from repo root (`/Users/josu/Documents/projects/ralph-cli`):

```bash
npx vitest run
```

Expected: all tests pass. Note the pass count; Task 4, Step 2 must equal this exact count (the deletion removes zero tests).

- [x] **Step 2: Confirm zero non-doc/non-self references to either script**

Run from repo root:

```bash
grep -rn "audit-tool-nodes\|backfill-plan-frontmatter" \
  --include="*.ts" --include="*.js" --include="*.mjs" \
  --include="*.json" --include="*.dot" --include="*.sh" --include="*.md" \
  2>/dev/null \
  | grep -v "meditations/illuminations" \
  | grep -v "memory/" \
  | grep -v "docs/superpowers/specs" \
  | grep -v "docs/superpowers/plans/2026-05-03-janitor-dead-scripts\.md" \
  | grep -v "scripts/audit-tool-nodes\.mjs" \
  | grep -v "scripts/backfill-plan-frontmatter\.sh"
```

Expected output: empty (no lines printed). Any hit means a new caller appeared since the design doc was written — pause and re-design before proceeding.

The greps that are intentionally excluded:
- `meditations/illuminations/2026-05-01T0255-janitor-dead-scripts.md` — the originating illumination, historical record.
- `memory/2026-04-25-plans-have-no-lifecycle.md` — descriptive memory note (design §6).
- `docs/superpowers/specs/2026-05-03-janitor-dead-scripts-design.md` — the design doc that authorizes this change.
- `docs/superpowers/plans/2026-05-03-janitor-dead-scripts.md` — this plan file.
- The two doomed files themselves.

- [x] **Step 3: Confirm `package.json` does not bind either script**

Run from repo root:

```bash
node -e "const p = require('./package.json'); console.log('scripts:', JSON.stringify(p.scripts, null, 2)); console.log('files:', JSON.stringify(p.files));"
```

Expected output (verbatim):

```
scripts: {
  "build": "tsup",
  "dev": "tsx watch src/cli/index.ts",
  "test": "vitest run",
  "test:watch": "vitest"
}
files: ["dist","meditations"]
```

If `scripts:` lists any binding referencing `scripts/` (e.g. `"audit": "node scripts/audit-tool-nodes.mjs"`), or `files:` includes `"scripts"`, pause — `package.json` has drifted since the design doc; re-ground before edits. The `files:` array confirms the npm-published tarball was already excluding `scripts/`, so this deletion changes zero published bytes.

- [x] **Step 4: Confirm both target files exist with the expected size before deletion**

Run from repo root:

```bash
wc -l scripts/backfill-plan-frontmatter.sh scripts/audit-tool-nodes.mjs
```

Expected output (line counts as anchored in design §3.1):

```
     121 scripts/backfill-plan-frontmatter.sh
      38 scripts/audit-tool-nodes.mjs
     159 total
```

If the counts differ, the files have been edited since the design doc was anchored — pause, re-read the files, and confirm the dead-code claim still applies before proceeding.

- [x] **Step 5: Confirm the audit script header still self-identifies as dev-only**

Run from repo root:

```bash
sed -n '1,4p' scripts/audit-tool-nodes.mjs
```

Expected output (verbatim, per design §3.3):

```
#!/usr/bin/env node
// scripts/audit-tool-nodes.mjs
// Walk pipelines/**/*.dot, list tool nodes + their tool_command or script_file.
// Suggests cwd value based on prefix patterns. Dev-only, not shipped.
```

If the header has changed (e.g. the "Dev-only, not shipped" line was removed and the script was re-bound to a workflow), pause — the dead-code claim is no longer accurate.

- [x] **Step 6: Confirm the backfill script's STATUS guard would still exit 1 today**

Run from repo root:

```bash
ls docs/superpowers/plans/ | sort > /tmp/plans-current.txt
sed -n '16,65p' scripts/backfill-plan-frontmatter.sh \
  | grep -oE '\[[0-9]{4}-[0-9]{2}-[0-9]{2}-[^]]*\]' \
  | tr -d '[]' \
  | sort > /tmp/plans-status-table.txt
echo "Overlap between current plans/ and STATUS table:"
comm -12 /tmp/plans-current.txt /tmp/plans-status-table.txt
echo "(empty above ⇒ guard at lines 70-72 exits 1 on first iter)"
```

Expected output:

```
Overlap between current plans/ and STATUS table:
(empty above ⇒ guard at lines 70-72 exits 1 on first iter)
```

If the overlap is non-empty, the backfill script could plausibly produce useful output today; pause and re-read design §1 before deleting. (Empty overlap is the dead-code signal that authorizes the deletion.)

### Task 2: Delete both files via `git rm` and remove the empty folder

**Files:**
- Delete: `scripts/backfill-plan-frontmatter.sh`
- Delete: `scripts/audit-tool-nodes.mjs`
- Remove: `scripts/` (empty directory after the two deletions)

- [x] **Step 1: `git rm` the bash script**

Run from repo root:

```bash
git rm scripts/backfill-plan-frontmatter.sh
```

Expected output:

```
rm 'scripts/backfill-plan-frontmatter.sh'
```

- [x] **Step 2: `git rm` the Node ESM script**

Run from repo root:

```bash
git rm scripts/audit-tool-nodes.mjs
```

Expected output:

```
rm 'scripts/audit-tool-nodes.mjs'
```

- [x] **Step 3: Remove the now-empty `scripts/` directory from the working tree**

Run from repo root:

```bash
rmdir scripts
```

Expected output: empty (no output on success). Git does not track empty directories, so this only affects the working tree — the `git rm` calls in Steps 1-2 already updated the index.

If `rmdir` errors with "Directory not empty", an unexpected file is still present (e.g. an untracked `.DS_Store` or a stray local file). Run `ls -la scripts/` to investigate before proceeding; do not `rm -rf` blindly.

- [x] **Step 4: Confirm the index and working tree both show the deletion**

Run from repo root:

```bash
git status --porcelain | grep -E '^.D scripts/' | sort
```

Expected output (exact two lines):

```
D  scripts/audit-tool-nodes.mjs
D  scripts/backfill-plan-frontmatter.sh
```

Run from repo root:

```bash
[ ! -d scripts ] && echo "OK: scripts/ removed" || echo "FAIL: scripts/ still present"
```

Expected output:

```
OK: scripts/ removed
```

- [x] **Step 5: Confirm git tracks no remaining files under `scripts/`**

Run from repo root:

```bash
git ls-files scripts/
```

Expected output: empty (no lines printed). Confirms both files are tracked-as-deleted (matches design §10.1).

### Task 3: Run static checks

**Files:** None modified.

- [x] **Step 1: TypeScript type check**

Run from repo root:

```bash
npx tsc --noEmit
```

Expected: clean exit, zero errors. Neither deleted file was in any `tsconfig.json` `include` glob (the `.sh` is not TypeScript at all; the `.mjs` was outside the `src/` include), so no error is plausible — but the check confirms no surprise reference exists in the type-checked tree.

If `tsc` errors, the error message will name the offending file. Read it, restore the appropriate file with `git restore --staged scripts/<name> && git checkout scripts/<name>`, and re-design before re-attempting.

- [x] **Step 2: Build check**

Run from repo root:

```bash
npm run build
```

Expected: `tsup` produces `dist/cli/index.js` (and the other tsup entries) with no error. `tsup.config.ts` does not list `scripts/` as an entry (verified by repo audit; design §3.3 / §8), so the deletion cannot break the build configuration.

If `npm run build` errors, capture the full stderr and pause — an unexpected build dependency on `scripts/` would invalidate the design's "zero surfaces crossed" claim.

- [x] **Step 3: Repo-wide grep — confirm zero remaining references in production surfaces**

Run from repo root:

```bash
grep -rn "audit-tool-nodes\|backfill-plan-frontmatter" \
  --include="*.ts" --include="*.js" --include="*.mjs" \
  --include="*.json" --include="*.dot" --include="*.sh" \
  src/ pipelines/ package.json tsup.config.ts \
  2>/dev/null
```

Expected output: empty (no lines printed). This is the post-deletion equivalent of Task 1, Step 2 — same dead-code claim, now confirmed against the modified tree.

If anything prints, the change is incomplete or a new caller appeared between Task 1 and now; do not commit yet.

### Task 4: Run the test suite

**Files:** None modified.

- [x] **Step 1: Full vitest run**

Run from repo root:

```bash
npx vitest run
```

Expected: all tests pass. Pass count must equal the baseline captured in Task 1, Step 1 (the deletion removes zero test files; no test imports either deleted script — verified by Task 1, Step 2).

If the count differs or any test fails, capture the failure output and pause — an undisclosed dependency on the deleted files would invalidate the design's "test ripple: none" claim (design §6).

### Task 5: Commit

**Files:** None modified beyond the staged deletions from Task 2.

- [x] **Step 1: Confirm staged content matches expectations**

Run from repo root:

```bash
git diff --cached --stat
```

Expected output (the two file deletions, in either order):

```
 scripts/audit-tool-nodes.mjs            |  38 -----------
 scripts/backfill-plan-frontmatter.sh    | 121 ---------------------------------
 2 files changed, 159 deletions(-)
```

(Whitespace alignment may vary; the key signal is "2 files changed, 159 deletions(-)" with zero insertions.)

If the diffstat shows insertions, edits to other files, or a different file count, pause and inspect with `git diff --cached`. Do not commit.

- [x] **Step 2: Commit the deletion**

Run from repo root:

```bash
git commit -m "$(cat <<'EOF'
chore(janitor): delete dead scripts/ folder

backfill-plan-frontmatter.sh — one-shot migration whose hardcoded STATUS
table targets plan files that no longer exist; guard at lines 70-72 exits
1 on first iter today.

audit-tool-nodes.mjs — dev-only audit helper with zero importers, zero
package.json#scripts bindings, zero callers; original cwd-migration audit
shipped earlier in project lifecycle.

scripts/ directory removed too; both files plus the now-empty folder land
in one commit so no intermediate junk-drawer state lands.

Refs: docs/superpowers/specs/2026-05-03-janitor-dead-scripts-design.md
EOF
)"
```

Expected: commit succeeds. The commit message body explains the why for both deletions (drawn from design §1 and §2). Pre-commit hooks, if any, may run — let them.

If a pre-commit hook fails: fix the underlying issue and create a NEW commit (do NOT `--amend`; the failed commit did not happen, so amending would alter the previous commit). Per repo convention.

- [x] **Step 3: Confirm the commit landed cleanly**

Run from repo root:

```bash
git log -1 --stat
```

Expected: the latest commit shows exactly two file deletions (both under `scripts/`), zero insertions, and the commit message above.

Run from repo root:

```bash
git status
```

Expected output:

```
On branch main
Your branch is ahead of 'origin/main' by 1 commit.
  (use "git push" to publish your local commits)

nothing to commit, working tree clean
```

(The "ahead by N commits" count depends on session state; the key signal is `nothing to commit, working tree clean`.)

### Task 6: Final smoke — published tarball file list unchanged

**Files:** None modified.

- [x] **Step 1: Confirm `npm pack --dry-run` excludes `scripts/`**

Run from repo root:

```bash
npm pack --dry-run 2>&1 | grep -E 'scripts/|=== ' | head -20
```

Expected: zero lines mentioning `scripts/`. `package.json:43-46`'s `"files": ["dist", "meditations"]` already excluded `scripts/` from the published tarball (design §6), so the file list is unchanged before vs. after this commit. This step is a sanity check, not a gating verification — but it cheaply confirms the design's "npm package: unaffected" claim.

If `scripts/` appears in the dry-run output, the npm `files` whitelist has been changed and this design's "npm package unaffected" claim is invalidated; pause and reconcile.

- [x] **Step 2: Confirm the CLI still loads after the build from Task 3, Step 2**

Run from repo root:

```bash
node dist/cli/index.js --help | head -5
```

Expected: top-level `ralph` help banner prints (the first 5 lines of usage text). The exact text must match what the same command produced before the deletion — the deletion changes no command surface (design §10.3).

If `node dist/cli/index.js --help` errors with a missing module or unexpected exception, the build was somehow disturbed; capture the error and pause.

## Verification targets

- Smokes: None (no pipeline behaviour change; deleted files were never referenced from any `pipelines/**/*.dot` graph or pipeline node)
- Manual exercises: `node dist/cli/index.js --help` post-build (top-level help unchanged); `[ ! -d scripts ] && echo OK` (folder removed); `git ls-files scripts/` returns empty
- Lint: `npx tsc --noEmit`, `npx vitest run`, `npm run build`
- Surfaces touched: None (neither file was reachable from any CLI command, pipeline node, agent rubric, test, or `package.json#scripts` binding; `package.json:43-46` already excluded `scripts/` from the published tarball)

---

## Rollback

If anything goes wrong post-commit (e.g. CI surfaces an undisclosed dependency that local checks missed), revert with:

```bash
git revert HEAD
```

The revert restores both files and the `scripts/` directory in one commit. The deleted files' contents remain in git history regardless (`git log --all -- scripts/` continues to surface them after the deletion commit, satisfying the "preserve history" use case noted in design §7).

No data migration, no schema change, no external service to coordinate with — rollback is purely local-tree.
