# Pipeline Commands Spec Backfill — Design

**Date:** 2026-04-18
**Status:** Approved (scoped)
**Source illumination:** `meditations/illuminations/2026-04-19T0600-specs-commands-missing-three-pipeline-subcommands.md`

## Overview

`specs/commands.md` is the command-reference layer consumed by the `illumination-to-implementation` pipeline's verifier subagent (it reads `specs/*.md` and `src/` as its two sources of truth). Today the `## ralph pipeline (subcommands)` section documents only three of the six registered subcommands: `run`, `list`, and `create`. The other three — `validate`, `refine`, and `trace` — are fully implemented in `src/cli/commands/pipeline.ts`, fully wired in `src/cli/program.ts` (lines 187, 222, 256), and carry detailed `.addHelpText()` blocks — yet have no entry in the spec layer.

This gap is invisible until an illumination makes a behavioral claim about one of those commands. When it does, the verifier's spec-check subagent finds nothing and silently falls back to `src/` alone — which is exactly the class of claim where spec and implementation can diverge. The same file is also about to receive an exit-code note for `run` (per illumination T0900 / 2026-04-19T0400). Batching all four additions into one coherent commit lands the spec layer's ground truth in a single diff.

This is a **pure documentation change**. No code, no tests, no behavior change. The implementation is four prose sections plus a small exit-code clarifier under `run`, committed as one edit to `specs/commands.md`.

## What Already Shipped (and is therefore out of scope)

The commands themselves are done. Every claim in this design is verified against current `main`:

1. **`validate`** — `pipelineValidateCommand` exists in `src/cli/commands/pipeline.ts`, registered at `src/cli/program.ts:187`. Accepts name shorthand or path; returns a numeric exit code that `program.ts:202` passes to `process.exit()`. Delegates to the graph validator (which the 2026-04-18 `reaches_exit` commit just extended).
2. **`refine`** — `pipelineRefineCommand` exists with `--project` and `--no-traces` flags (`program.ts:234-236`). Uses `composeCreatePrompt()`, `listRecentTraces()` + `digestTraceFile()` for up-to-three trace digests, and passes `previousGraph` into `pipelineValidateCommand` on exit for the `diffEdgeLabels()` check.
3. **`trace`** — `pipelineTraceCommand` exists with `--node-receive <id>` and `--full` flags (`program.ts:258-259`). Reads `~/.ralph/runs/<runId>/pipeline.jsonl`.
4. **`run`'s exit behavior** — `pipelineRunCommand` already `process.exit(1)`s on four pre-engine failures (file missing, invalid DOT, missing declared inputs, headless-safe + no TTY) and returns normally (exit 0) on engine failure; the post-failure refine tip has already shipped. The `run` section in `specs/commands.md` never documents any of that.

This spec does **not** redesign those commands. References to their internals appear only so the spec prose is correct and the plan author avoids re-implementing solved work.

## The Gap

`specs/commands.md:153-183` contains:

- `### ralph pipeline run <dotfile> [...]` — detailed section, no exit-code table.
- `### ralph pipeline list [folder]` — one-line.
- `### ralph pipeline create <name>` — one-line.

Missing entirely:

- `### ralph pipeline validate <dotfile>`
- `### ralph pipeline refine <name>`
- `### ralph pipeline trace <runId>`

The `refine` gap is the largest-surface one: two-phase Claude session, gated trace injection, conflict guard (must-exist, inverse of `create`'s must-not-exist), edge-label diff on exit. The separate file `specs/2026-04-17-refine-run-history-and-failure-tip-design.md` describes the **shipping event**, not the command reference — the spec-check subagent grepping for `ralph pipeline refine` behavioral claims in `commands.md` finds nothing.

## Architecture

The change is a single-file edit to `specs/commands.md`. No new files, no cross-file restructuring. The existing sibling sections (`run`, `list`, `create`) define the shape: a `###` heading carrying the full synopsis including flags, a one-to-three-paragraph description, optional sub-sections for deeper topics, and prose exit-code notes where relevant.

### Edit plan

Within the existing `## ralph pipeline (subcommands)` block (beginning at `specs/commands.md:153`):

1. Immediately after the `run` section (currently ends at line 174, before `### ralph pipeline list`), insert a new **`Exit codes`** subsection for `run` — not a new `###` command heading, a subsection of the existing `run` section. Three bullets covering: exit 1 on the four pre-engine guards (file missing, invalid DOT, missing declared inputs, headless-safe + no-TTY); exit 0 on engine success; exit 0 on engine failure (the Ink renderer paints `fail`, the `refine` tip is emitted, and the process returns normally — a known discoverability choice documented in the 2026-04-17 refine-tip design). The fact that engine failure does not produce a non-zero exit code is counter-intuitive and must be stated explicitly; it is the detail the verifier most often gets wrong.

2. After the `list` section, insert **`### ralph pipeline validate <dotfile>`**. Accepts name shorthand or a path; `--project <folder>` resolves `<name>` via `isNameShorthand` + `getPipelinesDir`. Checks: missing start/exit nodes, unknown shapes, edges referencing undeclared nodes, `reaches_exit` dead-ends (added 2026-04-18). Exit 0 on valid, 1 on any structural error. One additional sentence: when `pipelineRefineCommand` invokes it internally, it also receives `previousGraph` and emits edge-label diff diagnostics via `diffEdgeLabels()` — this is not a user-facing flag, only a note that the same entry point does double duty.

3. After the `validate` section, insert **`### ralph pipeline refine <name> [--project <folder>] [--no-traces]`**. Paragraph one: requires the `.dot` to already exist (inverse of `create`'s conflict check); runs `composeCreatePrompt()` to inject project-local agent awareness; injects up to three recent run-trace digests via `listRecentTraces()` + `digestTraceFile()` unless `--no-traces`; passes `previousGraph` to `pipelineValidateCommand` on exit for the edge-label diff. Paragraph two (flags): `--project` for pipelines-dir resolution, `--no-traces` to suppress the digest block. Paragraph three (exit codes): exits non-zero if `claude` is not on PATH; exits non-zero if the `.dot` file does not exist after the session completes; otherwise exits with the result of the final `pipelineValidateCommand` call. No `refine`-tip is printed (refine is already the target of that tip).

4. After the `refine` section, insert **`### ralph pipeline trace <runId> [--node-receive <id>] [--full]`**. Paragraph one: reads `~/.ralph/runs/<runId>/pipeline.jsonl` (the fresh-per-run JSONL trace, distinct from `~/.ralph/runs/<slug>/` checkpoint state — see the `run` section's existing note on the two paths). Without flags, prints all node invocations with status and a context-key summary. With `--node-receive <id>`, prints the full context snapshot at that invocation plus completed stages up to that point. `--full` disables context-value truncation. Paragraph two (exit codes): exits 1 if the trace file is not found; exits 0 on success.

### Why one file, one commit, four sections

The verifier subagent's prompt treats `specs/*.md` atomically — a partial backfill still looks like a gap until the last entry lands. If each subcommand entry were committed separately, every intermediate commit would leave an incomplete spec layer that would rerun the verifier-misses-spec failure mode for any illumination touched in that window. Landing `run` exit-codes + three new sections together closes the whole gap at once.

### Content-style alignment

All four additions follow the conventions already established by the `run`, `list`, and `create` sections:

- Synopsis line included in the `###` heading (including optional flags in `[...]`).
- Bullet blocks for flags (matching `run`'s `**Flags:**` list).
- Prose paragraphs — not tables — for exit-code descriptions; the existing `## Error Handling` table at `specs/commands.md:191-202` covers cross-command behavior and should NOT be expanded for the new pipeline subcommands. Pipeline subcommand exit behavior is subcommand-local and belongs with the subcommand.
- No code blocks beyond inline backticks for filenames, flags, and single identifiers.

## Components

### 1. `run` exit-code subsection

Inserted between the existing `**Tool-node idempotency requirement:**` paragraph (ending at line 174) and `### ralph pipeline list`. A bolded subsection header `**Exit codes:**` followed by three bullets. Explicitly state that engine-failure (non-success result status) exits 0 — this is the single most surprising fact and must be called out by name.

### 2. `validate` section

Single `###` heading with synopsis including `<dotfile> [--project <folder>]`. Describe the validator's check categories (structural: start/exit, unknown shapes, undeclared edge targets, `reaches_exit`). One sentence on name-shorthand resolution reuses the existing `run` section's phrasing to stay consistent. One short paragraph on the edge-label diff path.

### 3. `refine` section

Single `###` heading with synopsis `<name> [--project <folder>] [--no-traces]`. Three short paragraphs: behavior, flags, exit codes. Cross-reference `specs/2026-04-17-refine-run-history-and-failure-tip-design.md` only by file path, not by quoting — that doc is an implementation record and should not be re-summarized in the command reference.

### 4. `trace` section

Single `###` heading with synopsis `<runId> [--node-receive <id>] [--full]`. Two short paragraphs: behavior, exit codes. Reuse the existing `run` section's `~/.ralph/runs/<runId>/pipeline.jsonl` phrasing to keep the two-paths clarification in a single place rather than re-explaining it.

### 5. No test changes

Documentation-only edit. `specs/commands.md` has no automated test coverage. The gate is `npm run build` remaining green (it ignores `.md` changes anyway) and the verifier's spec-check subagent succeeding on a follow-up illumination that references a `validate`/`refine`/`trace` behavior.

## Data Flow

```
illumination referencing `ralph pipeline refine` behavior
        │
        ▼
illumination-to-implementation pipeline → verifier node
        │
        ▼
verifier reads specs/*.md + src/
   ├── BEFORE this edit: finds no `refine` section → falls back to src/ alone
   │                     → cannot distinguish "specified" from "implemented"
   │                     → silent verification gap
   │
   └── AFTER this edit: finds `### ralph pipeline refine <name> [...]` section
                        → confirms behavioral claims against spec + src
                        → full ground truth
```

## Constraints

- **Single file, single commit.** `specs/commands.md` is the only file touched. The four additions ship together.
- **Pure documentation.** No code, no tests, no `.dot` changes, no prompt changes.
- **Follow existing section conventions.** Match the `run`/`list`/`create` style: heading with synopsis, short paragraphs, inline backticks for identifiers, no new tables.
- **No dedicated design doc in commands.md body.** Cross-references to `specs/2026-04-17-refine-run-history-and-failure-tip-design.md` are file-path only, not quoted or summarized inline.
- **`run`'s engine-failure-exits-0 note must be explicit.** This is the single most counter-intuitive detail and the one the verifier most often gets wrong; it must be stated in the exit-codes subsection, not implied.
- **No expansion of the cross-command `## Error Handling` table.** Pipeline subcommand exit behavior is subcommand-local.
- **No change to the `run` section's headline or existing sub-sections.** Only the new `**Exit codes:**` subsection is added; checkpoint/resume and tool-node idempotency paragraphs are untouched.
- **Gate.** `npm run build && npm test` green before commit (no tests should change, but gating ensures accidental edits to sibling files are caught).

## What This Excludes

- **Any change to the commands' behavior.** If `validate`, `refine`, or `trace` has a bug, that is a separate illumination.
- **Restructuring the pipeline section.** The section ordering (`run`, `list`, `create`) is preserved; new entries slot in as additive `###` sections. `list` and `create` stay one-liners — matching their current depth; padding them for symmetry violates YAGNI.
- **Moving or renaming `specs/commands.md`.** The file is a known verifier input; changing its path is out of scope.
- **Adding a top-level "exit codes" table across all pipeline subcommands.** Exit behavior lives with each command's own section, consistent with the existing `run` section's prose style.
- **Removing or deprecating the separate design doc `specs/2026-04-17-refine-run-history-and-failure-tip-design.md`.** It remains the record of refine's shipping event; `commands.md` remains the command reference. The two layers serve different readers.
- **Adding machine-readable exit-code metadata.** Prose only; no YAML frontmatter, no JSON schema, no tags.
- **Any change to `.addHelpText()` blocks in `program.ts`.** Help text and spec are separately maintained by design — help text is the in-terminal synopsis, the spec is the authoritative behavioral contract. Keeping them independent means a help-text tweak doesn't force a spec edit.
