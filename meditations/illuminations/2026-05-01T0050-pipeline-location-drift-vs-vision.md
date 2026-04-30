---
date: 2026-04-30
description: Pipelines, specs, and the resolver chain disagree with VISION on where pipelines live — most visibly, the canonical `illumination-to-implementation` pipeline never reaches npm consumers because top-level `pipelines/` is not in package.json#files.
---

## Core Idea

`VISION.md` declares `illumination-to-implementation` the **bundled** canonical example, and rejects "per-project bespoke webs". Reality contradicts both. The pipeline lives at top-level `pipelines/illumination-to-implementation/`, which is **not** listed in `package.json#files` (`["dist", "meditations"]`) and is **not** copied by `tsup.config.ts` (which only mirrors `src/cli/pipelines/` → `dist/pipelines/`). So when ralph-cli is `npm install -g`'d, the canonical pipeline does not ship. At the same time, `README.md` and `docs/orientation/directory-inventory.md` still describe `pipelines/` as "project-local for ralph-cli itself", `docs/specs/architecture.md` lists files that no longer exist (`commands/plan.ts`, `new.ts`, `meditate-create.ts`, `src/cli/templates/`), and `pipeline-resolver.ts` has a five-step lookup chain (project-folder, project-flat, ~/.ralph-folder, ~/.ralph-flat, bundled) for a one-developer tool. The docs are agent fuel; right now they poison anyone (human or agent) who tries to reason about pipeline placement.

## Why It Matters

- **Shipping bug:** `package.json#files: ["dist", "meditations"]` plus `tsup` only copying `src/cli/pipelines/` means `pipelines/illumination-to-implementation/` (10 agents, the engine's flagship example) is dev-machine-only. Anyone running `npm i -g ralph-cli` gets `meditate`, `implement`, the just-bundled `janitor` (commit `67f4a76`) — but not the pipeline `VISION.md` calls "the canonical example".
- **Authoring confusion:** the resolver order privileges `<project>/pipelines/<name>/` first. For ralph-cli's own repo this means the top-level `pipelines/` shadows whatever is bundled — a pattern that worked under "per-project webs" but is now explicitly disowned by `VISION.md`.
- **Stale specs are agent fuel poison.** `docs/specs/architecture.md` lists `src/cli/commands/{plan,new,meditate-create}.ts` (gone), `src/cli/templates/` (never created — `directory-inventory.md` repeats this fiction). `MEMORY.md` still references `ralph new` and the kickoff session as if they exist. An agent following these specs writes code against a phantom layout.
- **Five-layer resolver for a one-developer tool** violates KISS. The flat-form fallbacks (`pipelines/<name>.dot`, `~/.ralph/pipelines/<name>.dot`) are YAGNI — every bundled and project pipeline is already folder-form per ADR-0001.
- **Janitor's recent move** (`67f4a76`) is exactly the right pattern (top-level → `src/cli/pipelines/janitor/`) but was applied as a one-off rename, not as part of a broader location policy. The `illumination-to-implementation` pipeline needs the same migration to honour VISION.

## Revised Implementation Steps

1. **Decide one location for "ralph's own bundled pipelines" and write it down.** Add a "Pipeline Location Policy" section to `VISION.md` (or `docs/specs/pipeline.md`) stating: bundled pipelines live in `src/cli/pipelines/<name>/`, ship via `tsup` to `dist/pipelines/`, and are referenced as name shorthand by every command shim. End the "Open" section once decided.
2. **Migrate `pipelines/illumination-to-implementation/` → `src/cli/pipelines/illumination-to-implementation/`.** Move agent files, `consume.mjs`, `tests/`, and `pipeline.dot`/`pipeline.svg`. Update `tests/consume.test.mjs` paths and any `pipeline-resolver.ts` test that hard-codes the old location. Verify it ships by running `npm pack` and inspecting the tarball for `dist/pipelines/illumination-to-implementation/pipeline.dot`.
3. **Fix `package.json#files` if VISION ever wants the smoke fixtures or scripts shipped** — likely not; smoke fixtures are tests, leave them at `pipelines/smoke/`. But explicitly note in the directory inventory that `pipelines/` (top-level) is now **only** `smoke/` test fixtures.
4. **Reconcile `docs/specs/architecture.md` + `docs/orientation/directory-inventory.md`** with the current `src/cli/commands/` (only `heartbeat.ts`, `implement.ts`, `meditate.ts`, `pipeline.ts`). Delete references to `plan.ts`, `new.ts`, `meditate-create.ts`, `src/cli/templates/`. Update README's "Directory Map" to match.
5. **Collapse `pipeline-resolver.ts` from five layers to three:** project folder-form → user-home folder-form → bundled. Drop both flat-form steps; ADR-0001 already mandates folder-form. Update the resolver tests to reflect this.
6. **Sweep `MEMORY.md`** for entries describing `ralph new`, `plan` command, `meditate-create`, and old `clack-prompts` UI. Mark them historical or remove. They are loaded into every session and outweigh more recent (correct) entries by sheer index size — `MEMORY.md` already exceeds the 200-line warning.
7. **Add a `pipeline list --bundled` flag** so anyone (you, an agent, an end-user) can confirm what actually ships without grepping `dist/`. Cheap, prevents recurrence of the shipping-bug class.
