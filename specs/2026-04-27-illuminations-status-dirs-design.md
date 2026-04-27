---
status: proposed
date: 2026-04-27
supersedes: specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md
---

# Illuminations Status-Based Directory Split — Design

## Overview

All illuminations currently live in a single directory `meditations/illuminations/` regardless of lifecycle status. As of 2026-04-27 the directory holds 89 files: 47 `open`, 5 `dispatched`, 9 `implemented`, 25 `archived`, and 3 hand-stamped `superseded` (manual convention, no code writes it). The active queue is therefore drowned in completed and rejected work — anything that inventories the project re-reads 37 files of historical context every time.

This design splits the layout so that on-disk presence reflects lifecycle:

| Status | Directory |
|---|---|
| `open`, `dispatched` | `meditations/illuminations/` |
| `archived` | `meditations/archived-illuminations/` |
| `implemented` | `meditations/implemented-illuminations/` |

`mark_archived` and `mark_implemented` physically move the file when they flip the frontmatter. `mark_dispatched` does not move (the file is still active work). New illuminations always start in `meditations/illuminations/` as `open`.

## What This Fixes

### Primary: active queue is no longer 40% completed work

`list_illuminations` with no filter currently returns all 89 files. After this change, it returns 52 (open + dispatched) — anything else is opt-in via status filter. Verifier nodes, manual `ls`, and any future "what's on the queue" surface all become honest by construction.

### Secondary: the spec drift the prior design tried to fix

`specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md` proposed a `meditations/illuminations/archive/` subdir for archived files. That design was approved but never shipped — `markArchived` writes to a path no one creates, and the directory does not exist on disk (verified `ls meditations/illuminations` 2026-04-27: no `archive/` entry). This design supersedes that approach. Top-level sibling directories are simpler than nested subdirs and symmetric across `archived` and `implemented`.

### Tertiary: `markImplemented` finally has a side effect proportional to its name

Today `markImplemented` only rewrites frontmatter — the implemented illumination still sits in the active queue indistinguishable from open work. After this change, marking implemented physically moves the file, mirroring `markArchived`'s shape.

## Out of Scope

- **No new lifecycle state.** `superseded` is removed as a recognized status. Only 3 files use it; all hand-edited in commit `a551c6c` (2026-04-22); no code path produces it. They will be re-stamped to `archived` during backfill with `archive_reason: "superseded by <existing superseded_by value>"`.
- **No new MCP tool.** `mark_superseded` is not introduced.
- **No archive subdirectory recursion.** Each of the three dirs is flat.
- **No new return field in `mark_dispatched`.** That call doesn't move the file, so no `new_path` is needed.
- **Plans-side lifecycle untouched.** `mark_plan_implemented`, plan frontmatter, and the `specs/` directory are out of scope.
- **No retroactive commits for already-mutated illuminations.** A clean `git status` is the precondition for the backfill script.

## Implementation Approach

### MCP server — `src/cli/mcp/illumination-server.ts`

#### `listIlluminations`

Today reads only from `join(projectRoot, "meditations", "illuminations")` and filters by frontmatter `status` inline. The conditional `archive/` subdir branch at line 333 is dead code (the subdir does not exist).

After: status determines source directory directly.

| `status` arg | Source dir | Inline frontmatter filter |
|---|---|---|
| `"open"` | `meditations/illuminations/` | `status: open` |
| `"dispatched"` | `meditations/illuminations/` | `status: dispatched` |
| `"archived"` | `meditations/archived-illuminations/` | none (whole dir is archived) |
| `"implemented"` | `meditations/implemented-illuminations/` | none |
| `undefined` | union across all three dirs | none |

Routing-by-dir makes status-filtered reads cheaper (no whole-tree read for `archived`/`implemented`) and tests easier (fixture placement = expected output, no frontmatter required in fixtures).

#### `writeIllumination`

No code change. New illuminations are always `open` and always land in `meditations/illuminations/`. Help-text string at line ~549 is updated to mention the new layout.

#### `markDispatched`

No code change. File stays in `meditations/illuminations/`; only frontmatter changes.

#### `markImplemented`

New behavior: physically move the file from `meditations/illuminations/` to `meditations/implemented-illuminations/`, using `git mv` semantics (write new + delete old, then `git add` both paths) so history is continuous.

Sequence:

1. Read source file at `meditations/illuminations/<filename>`.
2. Validate current status (`open` or `dispatched`, unchanged from today).
3. Update frontmatter: `status: implemented`, append `implemented_at: <today>`.
4. `mkdirSync(targetDir, { recursive: true })`.
5. Write updated content to `meditations/implemented-illuminations/<filename>`.
6. `rmSync` the original.
7. Auto-commit: `git add -A meditations/` then `git commit -m "meditate: implement <filename>"`. (Same auto-commit pattern as `writeIllumination`.)
8. Return `{ success, filename, previous_status, new_status, new_path }` — `new_path` is the new field, value `meditations/implemented-illuminations/<filename>`.

#### `markArchived`

Today moves the file to `meditations/illuminations/archive/<filename>` and returns `archive_path` in the response. After this change the target is `meditations/archived-illuminations/<filename>`. The `archive_path` field name stays (semantically "the archived path"); its value points to the new directory. Auto-commit message stays `meditate: archive <filename> (<reason>)`.

#### Tool description strings

Update at lines ~549, ~657, ~671 to mention the dir layout (`Write a meditation illumination file to meditations/illuminations/. After mark_archived or mark_implemented, the file moves to meditations/archived-illuminations/ or meditations/implemented-illuminations/`).

### Pipeline scripts — `pipelines/scripts/`

#### `mark-archived.mjs`

Today rewrites frontmatter in-place at `meditations/illuminations/<filename>`; **does not move the file** and **does not commit**. After: physically move to `meditations/archived-illuminations/<filename>`, then `git add -A meditations/` + `git commit -m "meditate: archive <filename> (<reason>)"` (same commit-message contract as the MCP `markArchived` path, so the move is durable when invoked from a pipeline). Emit JSON `{ marked_archived: <oldPath>, archive_path: <newPath> }` on stdout so `produces_from_stdout` can re-resolve.

Why both the script *and* the MCP path do the move + commit: `pipelines/illumination-to-implementation.dot:14–17` calls the script (not the MCP), and `mark_archived → done` is a terminal branch with no downstream `commit_push` step. Without the script committing, archived files would land on disk but never make it into git history — defeating the whole point of the prior 2026-04-25 spec's auto-commit fix.

#### `mark-dispatched.mjs`

No change.

#### No new `mark-implemented.mjs`

The `mark_implemented` MCP tool is called directly from agent rubrics (janitor and others). No script wrapper exists today and none is added.

### Pipelines — `pipelines/*.dot`

#### `pipelines/illumination-to-implementation.dot:10`

Today the verifier prompt hardcodes a glob: `Verify one illumination from $illuminations_dir/illuminations/*.md`. Replace with the same shape used by `illumination-to-plan.dot:8`: `Call mcp__illumination__list_illuminations with status: open ...`. This is the same fix the prior spec described, never shipped here.

#### `pipelines/illumination-to-plan.dot`

No change. Already calls `list_illuminations(status: open)`.

#### `pipelines/janitor.dot` & `pipelines/smoke/tmux-tester.dot`

No change. The janitor agent goes through MCP for everything. `tmux-tester.dot:6` hardcodes `meditations/illuminations/` for "newest file by mtime" — this is correct after the split because newly-written illuminations always start as `open` in that dir.

### Agents — `src/cli/agents/`

#### `verifier.md:44`

Drop hardcoded path construction. The `list_illuminations` MCP tool already returns full paths; the verifier should consume those instead of reconstructing `meditations/illuminations/<filename>`. Otherwise after the split, a verifier that re-reads by reconstructed path will 404 on any moved file.

#### `memory-writer.md:122`

Doc-only update — the comment mentions `meditations/illuminations/` as the resolution dir for `mark_implemented`. Update to mention the move.

#### Other agents

No change. `meditate.md`, `janitor.md`, `task.md`, etc. all go through MCP and inherit the new behavior.

### Scaffolding

#### `src/cli/commands/meditate.ts:42`

`ensureMeditationDirs` currently creates only `meditations/illuminations`. After: create all three subdirs (`illuminations`, `archived-illuminations`, `implemented-illuminations`).

#### `src/cli/commands/new.ts`

Currently does not create `meditations/` at all when scaffolding a new project. Add `mkdirSync` calls creating `meditations/illuminations/`, `meditations/archived-illuminations/`, `meditations/implemented-illuminations/` (parent created implicitly via `recursive: true`).

## Backfill

One-shot script at `scripts/migrate-illuminations-status-dirs.mjs` — committed once, deleted after the migration commit lands (it is not a long-lived utility).

Steps:

1. `git status --porcelain` — refuse on dirty tree (mirrors auto-commit preconditions in MCP).
2. For each `meditations/illuminations/*.md`:
   - Parse frontmatter `status`.
   - `open` or `dispatched` → leave in place.
   - `implemented` → `git mv` to `meditations/implemented-illuminations/`.
   - `archived` → `git mv` to `meditations/archived-illuminations/`.
   - `superseded` → rewrite frontmatter (`status: archived`, add `archive_reason: "superseded by <existing superseded_by value>"`, drop `superseded_by` and `superseded_at` keys), `git add` the rewrite, then `git mv` to `meditations/archived-illuminations/`.
   - Any other status → fail loudly with filename + status.
3. Single commit: `chore(meditations): split illuminations directory by status (backfill)`.

Expected counts (verified 2026-04-27): 9 `implemented` moved, 25 `archived` moved, 3 `superseded` re-stamped and moved, 52 stay (47 open + 5 dispatched).

### Re-run safety

The script is idempotent across re-runs on a clean tree. Step 2 iterates `meditations/illuminations/*.md` only — once a file has been moved out of that dir, the loop never sees it again. The `superseded` re-stamp clause matches on frontmatter `status`, so on a migrated checkout the loop matches zero files and exits as a no-op.

Failure mid-run leaves the tree dirty (some files moved, some not). Recovery: `git reset --hard <pre-migration-commit>`, then re-run. The script does not attempt mid-run resume; it relies on the single atomic commit at step 3 — anything before that commit is safely reversible.

## Test Plan

### Unit — `src/cli/tests/illumination-server.test.ts`

Replace existing `archive/` subdir tests with three-dir tests. Specifically:

- Remove tests asserting reads from `meditations/illuminations/archive/` (lines 550–614 per prior audit).
- Add `listIlluminations status=archived reads from meditations/archived-illuminations/`.
- Add `listIlluminations status=implemented reads from meditations/implemented-illuminations/`.
- Add `listIlluminations no filter returns union across three dirs`.
- Replace markImplemented "file stays" assertions (lines 634–733) with "file moved to implemented-illuminations/".
- Add `markImplemented returns new_path` and `markImplemented auto-commit message`.
- Update markArchived path assertions (lines 900–1070) to expect `meditations/archived-illuminations/<filename>`.

### Integration — `pipelines/smoke/`

Re-run existing smoke pipelines after the change. No new smoke pipeline is added; the dir-split is exercised by the existing illumination-pipeline smokes.

### Backfill verification

After running the migration script in a checkout:
- `meditations/illuminations/` contains exactly 52 files, all `status: open` or `status: dispatched`.
- `meditations/implemented-illuminations/` contains exactly 9 files.
- `meditations/archived-illuminations/` contains exactly 28 files (25 originally archived + 3 re-stamped from superseded).
- `git log -1 --oneline` matches the backfill commit message.

### MCP contract doc — `specs/mcp-illumination.md`

The contract doc is currently stale on three lines:
- `:29` — `write_illumination` path table.
- `:38` — `list_illuminations` reads-from declaration.
- `:86` — `mark_implemented` modifies-target.

Update each to reflect the three-dir layout. Add a `new_path` row to the `mark_implemented` and `mark_archived` return-shape tables. Anyone reading the MCP contract sees the wrong target dir today; this is doc-only but load-bearing.

## What This Supersedes

- `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md` — the `archive/` subdir layout it described is replaced by top-level sibling dirs. The two other issues that spec addressed (auto-commit on lifecycle mutations, archive readability via `listIlluminations`) are reaffirmed and shipped here. The old spec file is moved to `specs/archive/` or marked superseded inline once this design ships — handled in the implementation plan's final cleanup chunk.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Backfill corrupts files | `git status --porcelain` precondition + single atomic commit; reversible via `git revert` |
| Verifier path reconstruction (verifier.md:44) leaks past the split | Spec calls it out explicitly; covered by Task 8 in the plan |
| Any agent / pipeline still globs `meditations/illuminations/*.md` and assumes "all illuminations" | After the split, that glob is correct for "open + dispatched" by construction; only `illumination-to-implementation.dot:10` needs the prompt verb swap. Audited 2026-04-27 — no other hits. |
| Tests already aspirational for the prior `archive/` design break | Those tests are rewritten as part of the same plan tasks that change the production code (TDD red→green) |
| Future pipeline calls `mark_implemented` or `mark_archived` mid-flow and a downstream node reads the captured `$illumination_path` | Both the MCP responses and the script stdout now carry `new_path` / `archive_path`. Authors must re-bind the variable from the response (via `produces_from_stdout` or downstream prompt expansion), not reuse the pre-move capture. Currently no in-tree pipeline does mid-flow moves — `mark_archived → done` and `memory_writer → done` are terminal — but the contract is documented in `specs/mcp-illumination.md` so future authors see it. |

## Verification Matrix

| Component | Before-state evidence | After-state evidence |
|---|---|---|
| Layout on disk | `ls meditations/` → only `illuminations/` and `stimuli/` | `ls meditations/` → `illuminations/`, `archived-illuminations/`, `implemented-illuminations/`, `stimuli/` |
| `listIlluminations(status="archived")` | empty (reads non-existent `archive/` subdir) | returns 28 files from `archived-illuminations/` |
| `markImplemented` on a fixture | file stays in `illuminations/`, frontmatter updated | file in `implemented-illuminations/`, gone from `illuminations/`, response has `new_path` |
| `markArchived` on a fixture | tries to write to `archive/` subdir | file in `archived-illuminations/`, response `archive_path` matches |
| Active queue size | 89 files | 52 files |
