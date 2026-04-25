---
status: implemented
---

# Pipeline Commands Spec Backfill Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill `specs/commands.md` with the three missing `ralph pipeline` subcommand sections (`validate`, `refine`, `trace`) plus an explicit exit-codes subsection under `run`, so the illumination-to-implementation verifier's spec-check subagent has complete ground truth for pipeline subcommand claims.

**Architecture:** Pure documentation change. Two surgical `Edit` operations against `specs/commands.md`: one inserts an `**Exit codes:**` subsection at the tail of the existing `run` section; one inserts three new `###` subcommand sections (`validate`, `refine`, `trace`) between the existing `list` and `create` sections. No source files, tests, pipelines, or prompts change. Section ordering after edit: `run` (with new Exit codes subsection) → `list` → `validate` → `refine` → `trace` → `create`.

**Tech Stack:** Markdown only. Gate: `npm run build` + `npm test` green (they ignore `.md` changes but catch accidental sibling-file edits).

---

## Chunk 1: Backfill specs/commands.md

**Files:**
- Modify: `specs/commands.md` (two Edit operations; current file ends at line 202)

**Design source of truth:** `specs/2026-04-18-pipeline-commands-spec-backfill-design.md`

**Why one task, one commit:** The design doc (§"Why one file, one commit, four sections") requires all four additions to land atomically. A partial backfill leaves the spec layer in the same incomplete state the illumination flagged. Do not split this across commits.

**No TDD cycle applies.** `specs/commands.md` has no automated test coverage and there is no code under test. The verification step is an exact-string grep that each new section is present, followed by `npm run build && npm test` as a regression gate against accidental sibling edits.

---

### Task 1: Insert four sections into specs/commands.md and commit

**Files:**
- Modify: `specs/commands.md` — two Edit operations described in steps 2 and 3 below.

- [ ] **Step 1: Read the current `specs/commands.md`**

Run: `cat specs/commands.md | sed -n '153,183p'` (or use the Read tool with `file_path=/Users/josu/Documents/projects/ralph-cli/specs/commands.md`).

Expected output: the `## ralph pipeline (subcommands)` block containing exactly three subcommand sections — `run` (lines 157–174), `list` (lines 176–178), `create` (lines 180–182). If any of these anchor lines have moved, stop and realign old_string values below before editing.

- [ ] **Step 2: Insert the Exit codes subsection into the `run` section**

Use the `Edit` tool on `specs/commands.md`.

**Heading convention note:** All existing `### ralph pipeline …` headings in `specs/commands.md` wrap their synopsis in backticks (verified: lines 157, 176, 180 render as `` ### `ralph pipeline run …` ``). Every new `###` heading added below MUST also be backtick-wrapped to match. Both the Edit `old_string` anchors and the `new_string` content preserve that convention.

`old_string`:

```
Because `--resume` re-executes the node that was interrupted, scripts referenced by tool nodes (`type="tool"` + `script_file=`) must be idempotent. A script that enforces strict input-state invariants (e.g. "state must be X before I can act") will fail on resume when a prior partial attempt already advanced the state. Detect that the desired outcome is already present and exit 0 as a no-op instead. Reference pattern: `pipelines/scripts/mark-dispatched.mjs` — same `plan_path` → idempotent no-op, conflicting `plan_path` → error exit.

### `ralph pipeline list [folder]`
```

`new_string`:

```
Because `--resume` re-executes the node that was interrupted, scripts referenced by tool nodes (`type="tool"` + `script_file=`) must be idempotent. A script that enforces strict input-state invariants (e.g. "state must be X before I can act") will fail on resume when a prior partial attempt already advanced the state. Detect that the desired outcome is already present and exit 0 as a no-op instead. Reference pattern: `pipelines/scripts/mark-dispatched.mjs` — same `plan_path` → idempotent no-op, conflicting `plan_path` → error exit.

**Exit codes:**
- Exits with code 1 on any of the four pre-engine guard failures: the `.dot` file is missing, DOT parsing fails, declared `Graph.inputs` are not satisfied by `--var` or resolved defaults, or the pipeline is marked headless-safe and no TTY is attached.
- Exits with code 0 on engine success (all nodes advanced to an `exit` node without failure).
- Exits with code 0 on engine failure as well — when a node's retry budget is exhausted the Ink renderer paints `fail`, a post-failure tip suggesting `ralph pipeline refine <name>` is emitted, and the process returns normally. This is a deliberate discoverability choice (see `specs/2026-04-17-refine-run-history-and-failure-tip-design.md`); scripts that need to detect run failure should parse the JSONL trace at `~/.ralph/runs/<runId>/pipeline.jsonl` rather than rely on the exit code.

### `ralph pipeline list [folder]`
```

Note: this block is unique in the file — `` ### `ralph pipeline list [folder]` `` appears exactly once. No `replace_all` needed.

- [ ] **Step 3: Insert `validate`, `refine`, and `trace` sections between `list` and `create`**

Use the `Edit` tool on `specs/commands.md` a second time.

`old_string`:

```
### `ralph pipeline list [folder]`

Lists available pipeline DOT files in a folder.

### `ralph pipeline create <name>`
```

`new_string`:

```
### `ralph pipeline list [folder]`

Lists available pipeline DOT files in a folder.

### `ralph pipeline validate <dotfile> [--project <folder>]`

Validates the structure of a DOT-graph pipeline without executing any handlers. Accepts either a name shorthand (resolved via `isNameShorthand` + `getPipelinesDir`, matching `run`'s resolution) or a path to a `.dot` file. The `--project <folder>` flag sets the pipelines-dir base for name-shorthand resolution.

The validator checks: missing `start` or `exit` nodes; nodes using unknown shapes; edges referencing undeclared node ids; and `reaches_exit` — every non-exit node must have at least one path to an `exit` node (dead-end detection, added 2026-04-18).

Exit 0 when the graph is valid; exit 1 on any structural error. When invoked internally by `ralph pipeline refine`, the same entry point also accepts a `previousGraph` argument and emits edge-label diff diagnostics via `diffEdgeLabels()`; this is not a user-facing flag.

### `ralph pipeline refine <name> [--project <folder>] [--no-traces]`

Opens an interactive Claude session to refine an existing pipeline. Requires the target `.dot` to already exist (inverse of `create`'s must-not-exist conflict check). The session prompt is built via `composeCreatePrompt()` so the refined graph is aware of project-local agents; up to three recent run-trace digests are injected via `listRecentTraces()` + `digestTraceFile()` to ground refinements in observed behavior. On exit, the previous graph is passed to `pipelineValidateCommand` for an edge-label diff against the refined graph.

**Flags:**
- `--project <folder>` — resolves the pipelines-dir and sets the project scope used by `composeCreatePrompt()`.
- `--no-traces` — suppresses the recent-traces digest block in the prompt (useful when trace noise is misleading the session).

**Exit codes:**
- Exits non-zero if `claude` is not on PATH.
- Exits non-zero if the `.dot` file does not exist after the session completes.
- Otherwise exits with the result of the final `pipelineValidateCommand` call (0 on valid, 1 on structural error).

No post-failure `refine` tip is printed — `refine` is already the target of that tip. See `specs/2026-04-17-refine-run-history-and-failure-tip-design.md` for the shipping-event record.

### `ralph pipeline trace <runId> [--node-receive <id>] [--full]`

Inspects the JSONL trace from a completed or in-flight pipeline run. Reads `~/.ralph/runs/<runId>/pipeline.jsonl` — the fresh-per-run trace, distinct from the stable `~/.ralph/runs/<slug>/` checkpoint state (see the two-paths note in the `run` section).

Without flags, prints every node invocation with status and a summary of relevant context keys. With `--node-receive <id>`, prints the full context snapshot at that node's invocation plus the list of completed stages up to that point. `--full` disables context-value truncation so long values appear in their entirety.

**Exit codes:**
- Exits 1 if the trace file at `~/.ralph/runs/<runId>/pipeline.jsonl` does not exist.
- Exits 0 on success.

### `ralph pipeline create <name>`
```

Note: this block is unique in the file — the literal `` ### `ralph pipeline create <name>` `` heading appears exactly once. No `replace_all` needed.

- [ ] **Step 4: Verify all four additions are present**

Run (note: patterns use a literal backtick `\`` before `ralph pipeline …` to match the existing heading convention):

```bash
grep -cF '**Exit codes:**' specs/commands.md
grep -cF '### `ralph pipeline validate ' specs/commands.md
grep -cF '### `ralph pipeline refine ' specs/commands.md
grep -cF '### `ralph pipeline trace ' specs/commands.md
```

Expected output:

```
3
1
1
1
```

The `3` accounts for the three `**Exit codes:**` bolded subsection headers introduced by the refine, trace, and run edits. If any count is off by one, the Edit did not land cleanly — re-read the file and redo the affected step.

- [ ] **Step 5: Verify section order with a single grep**

Run:

```bash
grep -nF '### `ralph pipeline' specs/commands.md
```

Expected output (exact order — line numbers will shift but the ordering must match):

```
<line>:### `ralph pipeline run <dotfile> [--project <folder>] [--resume] [--var key=value]...`
<line>:### `ralph pipeline list [folder]`
<line>:### `ralph pipeline validate <dotfile> [--project <folder>]`
<line>:### `ralph pipeline refine <name> [--project <folder>] [--no-traces]`
<line>:### `ralph pipeline trace <runId> [--node-receive <id>] [--full]`
<line>:### `ralph pipeline create <name>`
```

If `create` is not last in this list, the second Edit inserted the new sections in the wrong anchor — stop and fix before continuing.

- [ ] **Step 6: Run the build + test gate**

Run: `npm run build && npm test`

Expected output: build completes successfully; test suite reports the same pass/fail summary as before this edit (no new test files, no changed test outputs — markdown edits are outside the TypeScript sources tsup watches and outside the `src/**/*.test.ts` test discovery pattern). If any test regresses, inspect `git diff` for accidental edits to a sibling file and revert.

- [ ] **Step 7: Confirm no sibling files changed**

Run: `git status --short specs/`

Expected output (exact):

```
 M specs/commands.md
```

If any other file under `specs/` shows modified, revert it with `git checkout -- <path>` before committing — the design constrains this to a single-file change.

- [ ] **Step 8: Commit**

```bash
git add specs/commands.md
git commit -m "$(cat <<'EOF'
docs(specs): backfill pipeline validate/refine/trace + run exit codes

Adds three missing pipeline subcommand sections (validate, refine, trace)
and an explicit Exit codes subsection for run to specs/commands.md.
Closes the silent spec-check gap where the illumination-to-implementation
verifier found nothing for those subcommands and fell back to src/ alone.

Design: specs/2026-04-18-pipeline-commands-spec-backfill-design.md
Illumination: meditations/illuminations/2026-04-19T0600-specs-commands-missing-three-pipeline-subcommands.md
EOF
)"
```

Expected output: one commit created; `git log -1 --stat` shows exactly `specs/commands.md` modified with insertions and zero deletions beyond the two anchor-line replacements.
