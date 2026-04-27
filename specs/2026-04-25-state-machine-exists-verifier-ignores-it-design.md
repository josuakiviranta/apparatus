> **SUPERSEDED 2026-04-27** by `specs/2026-04-27-illuminations-status-dirs-design.md`. The `archive/` subdir layout described below was never shipped; the new design uses top-level sibling dirs (`meditations/archived-illuminations/`, `meditations/implemented-illuminations/`) instead. Auto-commit and archive-readability fixes from this design are reaffirmed and shipped as part of the supersede.

---

# State Machine Exists, Verifier Ignores It — Design

**Date:** 2026-04-25
**Status:** Approved
**Source illumination:** `meditations/illuminations/2026-04-14T0600-state-machine-exists-verifier-ignores-it.md`

## Overview

The illumination state machine (`open → dispatched → implemented → archived`) is implemented in `src/cli/mcp/illumination-server.ts` and the `mark_dispatched` / `mark_archived` nodes are wired into `pipelines/illumination-to-plan.dot`, but three lifecycle gaps make the machine ineffective end-to-end:

1. **The verifier ignores its own filter.** `pipelines/illumination-to-plan.dot:8` step 1 reads `Run glob on $meditations_dir/illuminations/*.md to list all illumination files.` — a raw filename listing with no status awareness. An illumination already marked `dispatched` will be re-selected, re-verified by 50 subagents, and routed to `design_writer` again, generating a duplicate plan for in-flight work.
2. **State transitions are not committed.** `writeIllumination` auto-commits via `execSync` at `src/cli/mcp/illumination-server.ts:33-38`, but the three mutation functions — `markImplemented` (line 93), `markDispatched` (line 146), `markArchived` (line 203) — only call `writeFileSync` (and `rmSync` on line 205 for archive). After a pipeline run, `git status` shows a dirty tree; a developer who pushes before manually committing loses the lifecycle markers from history.
3. **The archive is unqueryable.** `markArchived` writes the moved file to `meditations/illuminations/archive/` (line 201), but `listIlluminations` reads only the top-level illuminations directory (`dir` at line 282, `readdirSync` at 284). `list_illuminations(status="archived")` always returns `"No illuminations found."` despite the MCP tool being registered with the `archived` enum value (line 493).

This spec closes all three gaps with the smallest possible surface change. No new modules, no new MCP tools, no engine changes — only one prompt-string edit, one copy-paste of an existing commit pattern (three call sites), and one conditional directory swap.

## What This Fixes

### Primary: re-processing of dispatched illuminations

`pipelines/illumination-to-plan.dot:18` already calls `mcp__illumination__mark_dispatched` after `design_writer` succeeds, so the state-write side of the machine is correct. The bug is purely on the read side: step 1 of the verifier prompt at line 8 enumerates filenames with `glob` instead of asking the MCP server for `status: open` only. Switching that one step to call `list_illuminations(status: open)` makes the machine's filter the actual gate, not a suggestion.

### Secondary: lifecycle history persisted to git

The auto-commit pattern at `illumination-server.ts:33-38` is four lines and already battle-tested:

```ts
try {
  execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
  execSync(
    `git -C "${projectRoot}" commit -m "meditate: add illumination ${filename}"`,
    { stdio: "ignore" },
  );
} catch {
  // git not available, not a git repo, or nothing to commit (idempotent re-run).
  // The file is already written; commit failure must not break the tool call.
}
```

The same shape is appended to `markImplemented`, `markDispatched`, and `markArchived` after their `writeFileSync` calls. `markArchived` additionally has to stage the deletion of the original file (`rmSync` at line 205) — the `git add -A` form is not used; instead the function explicitly `git add`s both the new archive path and the original path, so the rename is recorded as a single commit.

### Tertiary: archived items become queryable

`listIlluminations` at `illumination-server.ts:281-304` always reads `join(projectRoot, "meditations", "illuminations")`. When `status === "archived"` is requested, swap `dir` to the `archive/` subdirectory before `readdirSync`. All other status values continue reading the top-level directory unchanged. This restores the MCP tool's full surface area as advertised on lines 487-499.

## What This Does NOT Do

- **No change to `pipelines/illumination-to-implementation.dot`.** The newer pipeline already routes mark-* operations through `pipelines/scripts/mark-*.mjs` script_files (referenced from the spec-drift design at `specs/2026-04-19-mark-archived-spec-drift-design.md:118-123`). Touching it is out of scope; the in-tree user-facing pipeline that still has the bug is `illumination-to-plan.dot`.
- **No new MCP tool.** `list_illuminations(status="archived")` already exists (`illumination-server.ts:487-499`); the fix is to make it actually read from `archive/`. No new server capability is added.
- **No new state.** `open → dispatched → implemented → archived` stays. No `re-opened`, no `parked`, no escape valves.
- **No retroactive commits for already-mutated illuminations.** If a developer ran the pipeline before this spec landed and now has a dirty tree with manual mark-* edits, those uncommitted changes are theirs to handle. The fix applies to mutations from the next pipeline run forward.
- **No archive subdirectory recursion.** `archive/` is a single flat directory — `markArchived` writes directly to `join(illumDir, "archive", filename)` (line 201). Nested archive folders are not introduced.
- **No `list_illuminations` "all statuses across both dirs" mode.** When `status` is omitted, the tool reads only the top-level (current behavior preserved). A combined view across `open` + `archive` is a future feature; the rubric in the illumination only asks for `status="archived"` to start working.
- **No git fail-loud.** The `try/catch` swallows commit errors silently, matching `writeIllumination`'s precedent. The reasons (no git, no repo, nothing to commit, hooks rejecting) are out of the MCP tool's contract; the file write is the load-bearing operation, the commit is best-effort durability.
- **No commit-message bikeshedding here.** The plan's responsibility to specify exact strings; this spec only fixes that the messages exist and follow the `meditate: ...` prefix already used by `writeIllumination`.

## Architecture

### 1. Verifier prompt — `pipelines/illumination-to-plan.dot:8`

Single-line edit inside the `verifier` node's `prompt=` attribute. The current step 1 reads:

> `1. Run glob on $meditations_dir/illuminations/*.md to list all illumination files.`

After:

> `1. Call mcp__illumination__list_illuminations with status: open to get the list of unprocessed illuminations.`

Step 2's empty-handling clause (`If no files exist, return preferred_label: empty, ...`) reads naturally over the new step 1 — the MCP tool's `"No illuminations found."` literal is the same empty-state signal the agent already handles.

The `verifier` agent already has access to MCP tools (the same agent uses `mcp__illumination__*` patterns elsewhere via the bundled MCP server registration at `src/cli/mcp/illumination-server.ts:392+`). No new tool registration, no agent rubric change beyond the prompt itself.

### 2. Auto-commit — `src/cli/mcp/illumination-server.ts`

Three call sites, identical shape, mirroring `writeIllumination:33-42`. After the existing `writeFileSync` (and, for archive, the `rmSync`), append:

#### `markImplemented` (after line 93)

```ts
try {
  execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
  execSync(
    `git -C "${projectRoot}" commit -m "meditate: mark ${filename} implemented"`,
    { stdio: "ignore" },
  );
} catch {
  // git not available, not a git repo, or nothing to commit (idempotent re-run).
}
```

#### `markDispatched` (after line 146)

Same shape; commit message `meditate: mark ${filename} dispatched`.

#### `markArchived` (after `rmSync(filePath)` at line 205)

Stages both the deletion of the original path and the addition of the archive path before commit:

```ts
try {
  execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
  execSync(`git -C "${projectRoot}" add "${archivePath}"`, { stdio: "ignore" });
  execSync(
    `git -C "${projectRoot}" commit -m "meditate: archive ${filename}"`,
    { stdio: "ignore" },
  );
} catch {
  // git not available, not a git repo, or nothing to commit (idempotent re-run).
}
```

The first `git add` of a deleted-from-disk path stages the deletion; the second `git add` stages the new archive file. One commit captures the rename.

### 3. Archive listing — `src/cli/mcp/illumination-server.ts:281-304`

Replace the body of `listIlluminations` so the directory selection branches on status. Smallest patch:

```ts
export function listIlluminations(projectRoot: string, status?: string): string {
  const baseDir = join(projectRoot, "meditations", "illuminations");
  const dir = status === "archived" ? join(baseDir, "archive") : baseDir;
  try {
    let files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (status) {
      files = files.filter((f) => {
        const content = readFileSync(join(dir, f), "utf-8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        if (!fmMatch) return status === "open"; // no frontmatter = open
        const statusMatch = fmMatch[1].match(/^status:\s*(.+)$/m);
        const fileStatus = statusMatch ? statusMatch[1].trim() : "open";
        return fileStatus === status;
      });
    }
    if (files.length === 0) return NO_ILLUMINATIONS_MESSAGE;
    return files
      .map((f) => `${f} — ${parseIlluminationDescription(join(dir, f))}`)
      .join("\n");
  } catch {
    return NO_ILLUMINATIONS_MESSAGE;
  }
}
```

The frontmatter-status filter inside the loop stays — it acts as a defensive double-check on the archive dir (every file there should already have `status: archived`, but a hand-edited file with the wrong frontmatter is filtered out cleanly).

When the `archive/` subdirectory does not exist (no archives yet), `readdirSync` throws `ENOENT`; the existing `catch` returns `NO_ILLUMINATIONS_MESSAGE`. Behavior parity with the empty-top-dir case.

### 4. Tests — `src/cli/tests/illumination-server.test.ts`

Add three deterministic round-trip tests against a temporary project root.

**Test A — dispatch round-trip.**

1. Call `writeIllumination` to create an `open` illumination.
2. Call `markDispatched` with a fake plan path.
3. Assert `listIlluminations(projectRoot, "open")` returns `NO_ILLUMINATIONS_MESSAGE`.
4. Assert `listIlluminations(projectRoot, "dispatched")` returns one line containing the filename.

**Test B — archive round-trip.**

1. Call `writeIllumination`.
2. Call `markArchived` with a reason string.
3. Assert the original path no longer exists.
4. Assert `listIlluminations(projectRoot, "archived")` returns one line containing the filename.

**Test C — auto-commit observability.**

In a temp dir initialized with `git init -b main` and an initial commit, assert that after `markDispatched` the working tree is clean (`git -C $projectRoot status --porcelain` returns empty) and `git log --oneline -1` shows the `meditate: mark ... dispatched` message. Mirror for `markImplemented` and `markArchived`. (`writeIllumination` already exercises this commit path, so the test framework needed for it exists in this file.)

All three tests are pure-Node and rely only on existing helpers in the test file. No new test scaffolding.

## Components

### `pipelines/illumination-to-plan.dot`

One edit, line 8: replace step 1 of the verifier prompt with the `list_illuminations(status: open)` call. No node additions, no edge changes, no new attributes, no producer-list change (the verifier's `produces=` already lists `preferred_label, illumination_path, summary, explanation`).

### `src/cli/mcp/illumination-server.ts`

Three appended `try/catch` blocks (one per `mark*` function) and one body rewrite of `listIlluminations`. Imports already include `execSync` (line 2), `join` (line 3), and the `fs` primitives. No new imports.

### `src/cli/tests/illumination-server.test.ts`

Three new test cases. No structural changes to the suite.

## Data Flow

### Verifier entry — before vs after

```
Before:
  start → verifier
            └─ glob $meditations_dir/illuminations/*.md
               └─ returns ALL files (open, dispatched, implemented)
                  └─ verifier picks one  ←── bug: may pick dispatched
                     └─ design_writer  ←── duplicate plan
```

```
After:
  start → verifier
            └─ list_illuminations(status: open)
               └─ returns ONLY open files
                  └─ verifier picks one  (or returns preferred_label: empty if none)
                     └─ design_writer
                        └─ mark_dispatched  (next run won't see this file)
```

### Mark-* commit timeline

```
Pre-spec:
  pipeline run → markDispatched(file)
                   ├─ writeFileSync (frontmatter updated on disk)
                   └─ return { success: true }
                  ↓
                git status: dirty (untracked frontmatter change)
                  ↓
                developer pushes → state transition NOT in history

Post-spec:
  pipeline run → markDispatched(file)
                   ├─ writeFileSync (frontmatter updated on disk)
                   ├─ git add file
                   ├─ git commit -m "meditate: mark file dispatched"
                   └─ return { success: true }
                  ↓
                git status: clean
                  ↓
                developer pushes → state transition is in history
```

### `list_illuminations` directory routing

```
Caller passes status →  status="archived" ?
                          ├─ yes → readdirSync(meditations/illuminations/archive)
                          └─ no  → readdirSync(meditations/illuminations)
                                       (open / dispatched / implemented all live here)
```

The frontmatter filter inside the function is unchanged, so requesting `status="open"` still excludes any stragglers in the top-level dir whose frontmatter says `dispatched` (defensive layering preserved).

## Constraints

- **`writeIllumination`'s commit pattern is the contract.** All three mark-* functions use the identical four-line `try/catch` shape — same `stdio: "ignore"`, same swallow-on-failure rationale. The plan must not introduce a separate "git helper" abstraction; the duplication is intentional, per the existing precedent.
- **`mark_archived` stages the rename as one commit.** Two `git add` calls (deleted path + new path) followed by one `commit` — splitting into two commits would pollute history with a transient "delete only" state.
- **Verifier empty-handling is preserved by the new step 1.** `list_illuminations` returns the literal string `No illuminations found.` when nothing matches; the verifier prompt's existing step 2 (`If no files exist, return preferred_label: empty, ...`) handles this transparently because the agent reads the MCP response as plain text.
- **`archive/` directory absence is non-fatal.** Existing `try/catch` around `readdirSync` returns `NO_ILLUMINATIONS_MESSAGE` on `ENOENT`. Test B explicitly covers the post-archive case; the pre-first-archive case is implicit in the empty-tree behavior.
- **Schema and producer attributes are untouched.** No verifier output fields change. No `pipelines/schemas/verifier.json` edits. No agent rubric edits beyond the one prompt step in the `.dot`.
- **No engine changes.** `src/attractor/handlers/agent-handler.ts`, `src/attractor/transforms/variable-expansion.ts`, and validator code stay untouched. The fix lives entirely in MCP-server logic and one prompt string.
- **Test C requires `git init -b main` in the temp dir.** The other writeIllumination-based tests in the suite (which already exercise the commit path) establish the pattern; the plan reuses their setup helper rather than inventing one.

## Open Questions

None at design time. The illumination's three claims were verified verbatim against source by the verifier ("Every claim quoted matches source verbatim — file paths, line numbers, behavior all confirmed"), and the user approved the explainer's before/after at the gate without refinements.
