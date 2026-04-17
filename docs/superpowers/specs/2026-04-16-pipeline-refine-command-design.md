# Pipeline Refine Command Design

**Date:** 2026-04-16
**Status:** Approved
**Source illumination:** `meditations/illuminations/2026-04-15T1000-pipeline-create-has-no-iteration-workflow.md`

## Overview

Add `ralph pipeline refine <name>` so users can iterate on an existing pipeline `.dot` file with the same authoring-agent assistance that `ralph pipeline create` provides for blank-canvas authoring. Today, `pipeline create` refuses to run when the target file already exists and points the user at deletion or rename, both of which discard the pipeline's design context. After first creation, every subsequent edit happens through hand-editing DOT syntax with no agent guidance, no pattern awareness, and no protection against silent label/condition typos. This is the dominant activity of mature consumer projects (5–10 pipelines after six months) and currently has no first-class command.

`refine` reuses the two-phase Claude session mechanism already used by `create` and `plan`. The existing `.dot` file is read and injected verbatim into the kickoff trigger as the exemplar to revise. After a clean session exit, ralph runs `pipeline validate` automatically — same as `create` — closing the hand-edit → silent-error loop.

## Architecture

The command lives alongside the existing pipeline subcommands in `src/cli/commands/pipeline.ts` and is registered in `src/cli/program.ts`. It shares the path-resolution helper, two-phase Claude session helper, and post-session validation step with `pipelineCreateCommand`. The only behavioral differences are:

1. The pre-session check is **inverted**: `refine` requires the file to exist; `create` requires it to be absent.
2. The trigger prompt embeds the file's current content and frames the session as an edit, not a green-field design.
3. The conflict-error message in `pipelineCreateCommand` is updated to surface `refine` as the natural next step instead of pointing to deletion.

No new bundled prompt asset is required. The existing `PROMPT_pipeline_create.md` covers all 11 node types, edge attributes, and validation rules that `refine` also needs; `refine` prepends an additional framing block ("Here is the current pipeline …") to the same scheme. Keeping a single bundled scheme prompt avoids drift between the two commands.

## Components

### `pipelineRefineCommand` (new, `src/cli/commands/pipeline.ts`)

Signature mirrors `pipelineCreateCommand`:

```
ralph pipeline refine <name> [--project <folder>]
```

Behavior:

- `--project` defaults to cwd if omitted.
- `<name>` is resolved through the existing shared name-resolution helper to `<project>/pipelines/<name>.dot`. Explicit paths and `.dot` extensions are accepted, same as `create`.
- If the resolved `.dot` file does **not** exist, ralph prints `Pipeline not found: <path>\nUse 'ralph pipeline create <name>' to create it.` and exits non-zero.
- If the file exists, its full content is read into memory and inlined into the kickoff trigger:

  ```
  Here is the current pipeline workflow at <relative-path>:

  ```dot
  <verbatim file content>
  ```

  The user wants to refine it. Discuss what they want to change, propose targeted edits to the existing graph (do not redesign from scratch), then write the updated version back to <absolute-path>. Preserve node IDs and edge labels that the user does not explicitly want changed — downstream tooling routes on edge labels.
  ```

- The two-phase Claude session is launched with the bundled `PROMPT_pipeline_create.md` system prompt and the trigger above, identical to `create`.
- If the user cancels (SIGINT/SIGTERM) or Claude exits non-zero, ralph exits with the same status without running validation.
- On clean session exit, ralph re-reads the file and runs `pipeline validate` on it. Validation diagnostics are printed and the exit status reflects validation result.
- If the file no longer exists after a clean session exit (the agent deleted it), ralph prints a warning and exits non-zero.

### `pipelineCreateCommand` (modified)

The conflict-check message is updated. Current code at `src/cli/commands/pipeline.ts:488–492`:

```ts
if (existsSync(dotPath)) {
  await output.error(`Pipeline already exists: ${dotPath}\nDelete or rename it before running create.`);
  process.exit(1);
}
```

becomes:

```ts
if (existsSync(dotPath)) {
  await output.error(
    `Pipeline already exists: ${dotPath}\n` +
      `Use 'ralph pipeline refine ${name}' to modify it, ` +
      `or delete the file first to start over.`,
  );
  process.exit(1);
}
```

The `--force` flag mentioned in the source illumination is **deferred**. Refine is the recommended path for any change to an existing pipeline; explicit deletion remains the escape hatch for a true restart. Adding a third option in this iteration would dilute the discoverability gain.

### Program registration (`src/cli/program.ts`)

Import `pipelineRefineCommand` next to the existing imports:

```ts
import {
  pipelineRunCommand,
  pipelineValidateCommand,
  pipelineCreateCommand,
  pipelineRefineCommand,
  pipelineListCommand,
  pipelineTraceCommand,
} from "./commands/pipeline.js";
```

Register a `pipeline refine <name>` subcommand alongside the existing five, with the same `--project <folder>` option.

### Bundled prompt (no change)

`src/cli/prompts/PROMPT_pipeline_create.md` is reused as-is. The trigger string supplied at session launch time is the only thing that distinguishes `refine` from `create`.

## Data Flow

```
ralph pipeline refine <name> --project <folder>
        │
        ▼
resolveDotPath(name, project)  ──► <project>/pipelines/<name>.dot
        │
        ▼
existsSync(dotPath)?  ──no──►  print "Pipeline not found"; exit 1
        │ yes
        ▼
readFileSync(dotPath, "utf8")  ──►  existingContent
        │
        ▼
trigger = renderRefineTrigger(relativePath, dotPath, existingContent)
        │
        ▼
runTwoPhaseClaudeSession({
  systemPromptPath: bundled PROMPT_pipeline_create.md,
  trigger,
  cwd: project,
})
        │
        ├── SIGINT / non-zero exit ─►  exit with same status
        │
        ▼ clean exit
existsSync(dotPath)?  ──no──►  warn "file removed by session"; exit 1
        │ yes
        ▼
pipelineValidateCommand(dotPath)
        │
        ▼
exit with validation status
```

`runTwoPhaseClaudeSession` is the existing helper used by `pipelineCreateCommand` (and modeled after `plan.ts`). No new orchestration is introduced.

## Constraints

- **No new bundled prompt asset.** `refine` shares `PROMPT_pipeline_create.md` with `create`. Maintaining a separate `PROMPT_pipeline_refine.md` would duplicate the entire 11-node-type scheme description and create drift risk. The trigger string is the only delta, and it lives in code, not in a copyable user-customizable file.
- **Existing file content is injected verbatim, in a fenced `dot` block.** No reformatting, no canonicalization, no summarization. The agent receives exactly what the user has on disk so its proposed edits are reviewable as a textual delta.
- **Manifest awareness (T0300) is not added in this design.** When project manifest loading is built, `refine`'s trigger composition is the natural injection point. Until then, `refine` is graph-only context plus the bundled scheme.
- **Semantic validation (T0400) is not added here.** `refine` runs the same `pipelineValidateCommand` as `create`. As that command becomes semantic-aware, both paths benefit transparently.
- **`refine` does not accept `--force` and does not overwrite without a session.** Hand-editing is still possible (open `.dot` in any editor); `refine` is the agent-assisted path and that is the only thing it does. A `--force` option to bypass validation, or a non-interactive `refine` mode, are out of scope.
- **No git operations.** `refine` writes to the working tree and exits; staging and committing remain the user's responsibility, same as `create`.
- **Name validation, project resolution, and `.dot` extension handling are unchanged.** `refine` calls the same shared helper as `create`, `run`, `validate`, and `list`. Any future changes to name resolution (e.g., supporting subdirectories under `pipelines/`) apply to all five commands uniformly.
- **Documentation update is part of this work.** `README.md` gains a `pipeline refine` entry next to `pipeline create` with the explicit distinction: `create` for new workflows, `refine` for every subsequent change. Establishing the iteration pattern in docs early prevents the hand-edit habit from becoming the default.

## What This Excludes

- **`--force` flag on `create`** — refine is the recommended path; explicit file deletion remains the escape hatch.
- **Non-interactive `refine` mode** — the value of `refine` is the conversational design loop; a headless mode would just be a write-with-validation, which can already be done by editing the file and running `pipeline validate`.
- **Diff preview before write** — Claude's session output already shows the proposed edits before the file is written. A separate diff step would be redundant.
- **Multi-file refine** — `refine <name>` operates on exactly one pipeline. Cross-pipeline refactors are out of scope and would belong to a separate command.
