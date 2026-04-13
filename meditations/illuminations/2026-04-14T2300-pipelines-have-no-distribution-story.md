---
date: 2026-04-13
status: open
description: Pipelines are reuse-ready in format but trapped in the project that authored them — ralph bundles prompts and agents as first-class assets, but pipelines have no equivalent bundled library or fallback resolution path.
---

## Core Idea

ralph already knows how to bundle and distribute reusable assets: prompts live in `src/cli/prompts/`, agents in `src/cli/agents/`, both copied into `dist/` by tsup and resolved at runtime via `assets.ts`. Pipelines have none of this. They live only in the project that authored them. To run `illumination-to-plan.dot` against another project, you must manually copy the `.dot` file and its schemas there. The DOT format is abstract enough for reuse. The engine supports `--project` to target any directory. The schema resolution gap is being fixed. What's missing is the distribution layer that makes a pipeline runnable from any machine that has ralph installed.

## Why It Matters

The promise of `ralph pipeline run illumination-to-plan --project ../other-project` is real — the engine is fully capable of it. But it fails today for two reasons. First, the `.dot` file doesn't exist in the other project (no bundled fallback). Second, even if it did, the prompts inside it reference paths like `meditations/illuminations/*.md` and `docs/superpowers/specs/` — structure that only exists in ralph-cli itself, not in arbitrary consumer projects. These are the same two problems ralph already solved for prompts: bundle them, and write them against `$project`-relative conventions rather than absolute assumptions. Pipelines inherited neither solution.

`pipeline-resolver.ts` currently resolves a name shorthand (`illumination-to-plan`) to `$project/pipelines/illumination-to-plan.dot` and stops there. There is no fallback to a ralph-global location. Compare this to `agent-registry.ts`, which resolves agent names from `~/.ralph/agents/` — a global registry independent of any project. Pipelines have no equivalent.

## Revised Implementation Steps

1. **Create `src/cli/pipelines/`** and move `illumination-to-plan.dot` plus its schemas (`pipelines/schemas/`) there. This makes them a bundled asset alongside prompts and agents.

2. **Update `tsup.config.ts`** `onSuccess` hook to copy `src/cli/pipelines/` into `dist/cli/pipelines/`, mirroring how `src/cli/prompts/` and `src/cli/agents/` are copied today.

3. **Add `getBundledPipelinesDir()` to `src/cli/lib/assets.ts`** — resolves to `dist/cli/pipelines/` in prod, `src/cli/pipelines/` in dev. Same pattern as `getAgentsDir()` and `getPromptsDir()`.

4. **Update `pipeline-resolver.ts`**: when a name shorthand doesn't resolve to an existing file in `$project/pipelines/`, fall back to `getBundledPipelinesDir()`. Local project pipelines always win; bundled pipelines are the fallback. Same two-tier lookup that agent-registry uses.

5. **Audit bundled pipeline prompts** for ralph-cli-specific path assumptions. Any prompt that references `meditations/illuminations/`, `docs/superpowers/specs/`, or similar ralph-cli paths must either be parameterised with a variable the caller can supply, or documented as "ralph-cli internal only" and excluded from the bundled set.

6. **Document the distinction** in `specs/` or a new `docs/pipeline-library.md`: what makes a pipeline "bundled" (portable, project-agnostic, ships with ralph) vs. "project-local" (lives in `project/pipelines/`, may assume local structure). This gives future authors a clear target to write toward.
