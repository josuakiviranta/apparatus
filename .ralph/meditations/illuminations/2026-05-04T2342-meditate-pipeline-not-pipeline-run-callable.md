---
date: 2026-05-04
description: The bundled meditate pipeline declares inputs="steer,vision" but only ralph meditate pre-reads VISION.md — `ralph pipeline run meditate` fails preflight, while janitor's tool-node pattern keeps its sibling pipeline self-sufficient.
---

## Core Idea

Vision acquisition for `src/cli/pipelines/meditate/pipeline.dot` lives in `src/cli/commands/meditate.ts` — `readVisionIfPresent` reads `VISION.md` from the project root and passes its contents as `--var vision=<contents>`. The pipeline declares `inputs="steer,vision"`, so the preflight in `pipelineRunCommand` (`src/cli/commands/pipeline.ts`) rejects any invocation that does not pre-populate both. `ralph pipeline run meditate --project foo` therefore fails before any node runs, while `ralph meditate foo` works because the wrapper command secretly fills the inputs in. The sibling janitor pipeline solves the same problem the right way: a `read_vision` tool node + sibling `read-vision.mjs` script reads `VISION.md` from `cwd="$project"` and emits the contents into the graph context, leaving the agent's `default_vision=""` to cover the absent-file case. Janitor stands alone; meditate cannot.

## Why It Matters

- **Same pipeline, two behaviours depending on entry point.** `ralph meditate my-app` works; `ralph pipeline run meditate --project my-app` does not. The shorthand command is the only working invocation. The engine's primary command — the one the README and `program.ts` hold up as canonical — is a second-class citizen for this bundled pipeline.
- **Three reading sites for one file.** `VISION.md` is read in (1) `meditate.ts:readVisionIfPresent`, (2) `src/cli/pipelines/janitor/read-vision.mjs`, (3) implicit project-tree reads inside any agent that has `read_file`. ADR-0008 just relocated `VISION.md` from `.ralph/VISION.md` back to the repo root — a future move would force three lockstep edits with no single seam to enforce agreement. This is the "concept implemented twice with no single seam" failure-mode CONTEXT.md asks the janitor to flag.
- **Heartbeat surface inflation traces back to this.** `ralph heartbeat meditate <folder>` exists as its own subcommand (`src/cli/commands/heartbeat.ts:99-117`) instead of folding into `ralph heartbeat pipeline meditate`, because the pipeline cannot run unattended without the wrapper's variable-stuffing. Fix the pipeline and one entire heartbeat subcommand collapses, attacking the `command-surface-duplicates-pipeline-engine` debt at root.
- **VISION.md says "pipelines are the engine; ralph is the choreography."** Burying input acquisition in the wrapper command directly contradicts that line — the wrapper now owns behaviour the pipeline file pretends to declare. The bundled meditate pipeline is a misleading exemplar for project-local pipeline authors who copy from it.

## Revised Implementation Steps

1. Add a `read_vision` tool node to `src/cli/pipelines/meditate/pipeline.dot` with `cwd="$project"`, `script_file="read-vision.mjs"`, `produces_from_stdout=true`. Copy `src/cli/pipelines/janitor/read-vision.mjs` as a sibling file (file-copy reuse per ADR-0001 — no shared helper).
2. Wire the edges: `start -> read_vision -> meditate -> end`. Drop `vision` from the pipeline-level `inputs="steer,vision"` so it becomes `inputs="steer"`. The pipeline's `inputs=` declaration must list only caller-supplied inputs.
3. Update `src/cli/pipelines/meditate/meditate.md` frontmatter to `inputs: [steer, read_vision.vision]` and rewrite the body's `<vision>` placeholder to `<read_vision_vision>` (the `inputs-resolver.ts` rendered tag for a qualified input). Add `default_vision=""` to the `meditate` agent node so a missing `VISION.md` still produces an empty string.
4. Reduce `meditateCommand` in `src/cli/commands/meditate.ts` to call `pipelineRunCommand("meditate", { project, variables: { steer } })` and delete `readVisionIfPresent`. Keep PID-locking + `appendMeditateGitignore` for now; they are a separate gap that prior illuminations already track (`janitor-dual-pid-guards`).
5. Run `ralph pipeline run meditate --project ralph-cli --var steer=""` and confirm the pipeline executes end-to-end with no shorthand command involved. Then run `ralph meditate ralph-cli` and confirm parity.
6. Add a smoke-pipeline scenario at `.ralph/scenarios/bundled-pipelines-self-sufficient/` that invokes each bundled pipeline through `pipeline run` with only the documented `--project` and `--var` flags it advertises in its `inputs=` declaration. Failing this test is the contract that catches the next time a pipeline secretly relies on a wrapper command.
7. Once meditate is fixed, audit `src/cli/commands/heartbeat.ts:99-117` and remove the `meditate` subcommand: `ralph heartbeat pipeline meditate --project <folder> --every <n>` becomes the supported path. Document the deprecation in `CONTEXT.md`'s glossary.
