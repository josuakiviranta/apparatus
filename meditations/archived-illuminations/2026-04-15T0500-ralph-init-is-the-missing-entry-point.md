---
date: 2026-04-14
status: archived
description: Consumer projects have no guided path from `npm install -g ralph-cli` to a first working pipeline — `ralph new` serves brand-new projects, `ralph pipeline create` requires ralph-awareness that doesn't yet exist, and there is no `ralph init` command to bridge the two for existing codebases.
archived_at: 2026-04-27
reason: Depends on unbuilt ralph.config.js and bundled-pipelines prerequisites - scope creep
---

## Core Idea

ralph has two commands for getting started: `ralph new` (creates a brand-new project from scratch, runs `git init`, launches a brainstorm session) and `ralph pipeline create` (authors a pipeline inside an already-ralph-aware project). The dominant consumer path — an existing codebase that just ran `npm install -g ralph-cli` — fits neither. `ralph new` fails immediately: the directory already exists. `ralph pipeline create` produces a generic result: the project has no `pipelines/` directory, no `ralph.config.js`, no local exemplar pipelines. The authoring agent writes DOT for an imaginary project because there is nothing ralph-shaped in the directory to read. All six prior T-series illuminations (T2300–T0400) assume the consumer developer has already crossed this threshold. None of them create a command that helps cross it. `ralph init` is that command.

## Why It Matters

The gene transfusion lens names the condition: "The first transfusion is the expensive one." For a consumer project developer, the first transfusion is getting ralph correctly embedded in their project — creating the vocabulary (`ralph.config.js` conventions), establishing the exemplar set (a starter pipeline to transfuse from on subsequent `pipeline create` sessions), and pointing the engine at real project paths. Right now, every consumer developer performs this first transfusion manually: they must know to create `ralph.config.js` (T0300 proposes this, unimplemented), know to create a `pipelines/` directory, know what goes in a starter `.dot` file, and know which agents exist. That is a five-doc knowledge requirement before the first `pipeline run` succeeds.

Look at `scaffoldProject()` in `src/cli/commands/new.ts`. It creates `specs/`, `src/`, `scenario-tests/`, `scenario-runs/`, copies `PROMPT_plan.md` and `PROMPT_build.md`, writes `.gitignore`, then launches a two-phase Claude session. Everything there is correct — for a new project. But `scaffoldProject()` cannot be called against an existing project without destroying what's already there. And it still doesn't create `pipelines/` or `ralph.config.js` even for new projects.

The dark factory lens adds weight: an automated pipeline running against a consumer project needs the project's ralph configuration to be stable and declared, not discovered ad hoc each run. The manifest that T0300 proposes, the bundled pipelines T2300 proposes, the custom handlers T0200 proposes — all of them require the developer to have performed a conscious setup step. That step has no command. The developer who skips it (because they don't know it exists) gets a degraded experience on every subsequent interaction.

`pipelineListCommand` in `src/cli/commands/pipeline.ts:169-196` already surfaces the gap: when `pipelines/` doesn't exist, it prints `"No pipelines/ folder found in ${project}. Create one with: ralph pipeline create <name>..."`. The suggested next step assumes the developer is ready to author. They are not. The correct next step for a fresh consumer project is `ralph init`.

## Revised Implementation Steps

1. **Create `src/cli/commands/init.ts`**. The command accepts an optional `--project` path (defaults to `cwd`). It must not create or overwrite any file that already exists — every write is conditional, so running `ralph init` twice is safe. It skips `git init` entirely (the project already has a repo).

2. **Implement project-type detection** inside `init.ts`. Read the project directory for known marker files: `package.json` (Node/TypeScript), `go.mod` (Go), `requirements.txt` / `pyproject.toml` (Python), `Cargo.toml` (Rust). From the detected type, infer likely conventions: where specs live (`docs/`, `specs/`, `RFC/`), where tests live, what the build command is. Store these as local variables for the next step.

3. **Write `ralph.config.js` with detected values pre-filled**. Use the inferred conventions to populate the `variables` and `conventions` fields T0300 proposes. Leave `handlers` and `pipelines` fields as commented-out stubs with inline documentation. Detected fields are written as real values; unknown fields are commented with `// TODO: fill in`. Never overwrite an existing `ralph.config.js` — print a message and skip.

4. **Create `pipelines/` and scaffold `pipelines/hello.dot`** if neither exists. The starter should use the bundled template T2300 proposes (`getBundledPipelinesDir()`), or a hardcoded minimal fallback if that isn't implemented yet. The starter demonstrates exactly one non-trivial node type (e.g. a `ralph.run-scenarios` node gated by a `goal_gate` box) — enough to be a valid transfusion source for subsequent `pipeline create` sessions without overwhelming a first-time reader.

5. **Register `ralph init [project]` in `src/cli/program.ts`**. Place it immediately after `ralph new` in the command list. The help text should read: `"Add ralph pipeline support to an existing project (safe to run on any directory)."` The distinction from `ralph new` must be explicit in both `--help` output and in `README.md`.

6. **Update `pipelineListCommand`'s empty-state message** to suggest `ralph init` instead of `ralph pipeline create` when no `pipelines/` directory exists. The current message assumes the developer is past the setup phase. After `ralph init` exists, the correct entry-point message is: `"Run 'ralph init' to set up ralph in this project, then 'ralph pipeline create <name>' to add your first workflow."` This is the discoverable surface through which most consumer developers will find the command.
