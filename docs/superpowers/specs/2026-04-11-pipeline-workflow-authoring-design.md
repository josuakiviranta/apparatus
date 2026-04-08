# Pipeline Workflow Authoring Design

**Date:** 2026-04-11
**Status:** Approved

## Overview

Add tooling for creating, discovering, and managing attractor pipeline workflows (.dot files) within ralph-managed projects. Introduces `ralph pipeline create` and `ralph pipeline list`, establishes a canonical folder convention, and adds a name-based shorthand to existing `run` and `validate` commands.

## Folder Convention

All pipeline workflows for a project live in `<project>/pipelines/`. This folder is:

- Created automatically by `ralph pipeline create` on first use
- The default search location for name-based shorthand lookups
- Not created or required by any other ralph command

## Commands

### `ralph pipeline create <name> [--project <folder>]`

Launches an interactive Claude TUI session to author a new pipeline workflow.

- `--project` defaults to cwd if omitted
- `<name>` must be alphanumeric with hyphens/underscores only; `.dot` extension is added automatically if omitted
- If `<project>/pipelines/<name>.dot` already exists, ralph prints an error and exits — user must delete or rename the file first
- If `<project>/pipelines/` does not exist, ralph creates it; if directory creation fails, ralph prints the OS error and exits
- The bundled system prompt (`PROMPT_pipeline_create.md`) injects the full attractor scheme: all 11 node types with shapes, required/optional attributes, validation rules, and a complete reference example
- `PROMPT_pipeline_create.md` is **not** copied to the project folder — the attractor scheme is fixed and not user-customizable
- The session is a single direct interactive Claude invocation (unlike `ralph plan`, no non-interactive kickoff phase precedes it)
- If the user cancels (SIGINT/SIGTERM) or Claude exits non-zero, ralph exits with the same status code without running validation
- On clean session exit, ralph runs `pipeline validate` on the output file; if validation fails, ralph prints the diagnostics and exits non-zero
- If the file does not exist after a clean session exit, ralph prints a warning and exits non-zero

```bash
ralph pipeline create review --project my-app
# → errors if my-app/pipelines/review.dot already exists
# → creates my-app/pipelines/ if needed
# → launches interactive Claude session
# → on clean exit: validates my-app/pipelines/review.dot
# → prints: valid  or  2 errors found (exits non-zero on errors)
```

### `ralph pipeline list [--project <folder>]`

Scans `<project>/pipelines/*.dot`, reads the top-level `goal=` attribute from each file, and prints a summary table.

- `--project` defaults to cwd if omitted
- If `pipelines/` does not exist or is empty, prints a message pointing to `ralph pipeline create`

```bash
ralph pipeline list --project my-app

Pipelines in my-app/pipelines/
  review       "Run scenarios, meditate, then push"
  deploy       "Build, validate, and release"
  onboarding   (no goal defined)
```

### Shorthand for Existing Commands

`ralph pipeline run` and `ralph pipeline validate` gain a name-based shorthand. If the first argument contains no path separator and no `.dot` extension, ralph resolves it as `<project>/pipelines/<name>.dot`.

```bash
# Explicit path (existing behavior, unchanged)
ralph pipeline run ./pipelines/review.dot --project my-app
ralph pipeline validate ./pipelines/review.dot

# Name shorthand (new)
ralph pipeline run review --project my-app
ralph pipeline validate review --project my-app
```

## Implementation Notes

- `PROMPT_pipeline_create.md` is a new bundled asset, co-located with `PROMPT_plan.md` and `PROMPT_build.md` in `src/cli/prompts/`
- The prompt content should include: all node shapes and their types, required attributes per node type (e.g., `prompt=` for codergen), edge attributes (`condition=`, `label=`, `weight=`), validation rules summary, and a complete reference example
- The `create` session spawns Claude with `stdio: "inherit"` (same as `plan.ts`) but skips the two-phase kickoff — it is a single direct interactive invocation
- The system prompt is read from the bundled `PROMPT_pipeline_create.md`; its content must cover: shape→type mapping for all 11 node types, required attributes per type (`prompt=` for codergen, `toolCommand=` for tool nodes), edge attributes (`condition=`, `label=`, `weight=`), the 9 validation rules enforced by `validateGraph()`, and a complete annotated reference example
- Name resolution logic (shorthand → absolute path) is extracted to a shared helper in `src/cli/lib/pipeline.ts` and used by `create`, `run`, `validate`, and `list`
- Name shorthand resolution requires `--project` to be known; for `validate` without `--project`, shorthand resolves against cwd

## What This Excludes

- `ralph pipeline edit` — not needed; users can re-run `create` or edit the file directly
- Global/ralph-managed workflow library — workflows belong to the project (`<project>/pipelines/`), not to ralph-cli
- Heartbeat integration for pipeline tasks — already exists via `ralph heartbeat pipeline`
