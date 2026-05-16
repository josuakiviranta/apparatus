---
date: 2026-05-16
description: The apparatus codebase is organized into five top-level directories — src/, docs/, pipelines/, .apparat/, and config files — each with a distinct role that mirrors the two-tier pipeline architecture described in VISION.md.
---

## Core Idea

Apparatus has five meaningful top-level directories. `src/` holds all TypeScript source (engine, CLI, daemon, shared lib). `docs/` holds ADRs, harness guides, and design specs. `pipelines/` holds smoke-test fixtures for CI. `.apparat/` is the project's own apparat home — pipelines, meditations, scenarios, and sessions that apparatus uses to develop itself. Config files (`package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`) live at root.

## Why It Matters

This layout directly reflects the two-tier architecture in VISION.md: bundled pipelines live in `src/cli/pipelines/` (shipped with the npm package), while project-local pipelines live in `.apparat/pipelines/` (owned by this repo as a target project). The split is clean and self-consistent — apparatus eats its own cooking. The `pipelines/` root dir at repo top is a third tier used only for smoke fixtures, which is a mild naming ambiguity: a new contributor could confuse `pipelines/smoke/` with project-local `.apparat/pipelines/`.

## Revised Implementation Steps

1. **Verify the `pipelines/` root naming** — rename to `smoke/` or `fixtures/` to remove ambiguity with `.apparat/pipelines/` and `src/cli/pipelines/`. Three directories with "pipelines" in the path at different depths is a trap.
2. **Document the three-tier pipeline hierarchy** in `CONTEXT.md` — bundled (`src/cli/pipelines/`), project-local (`.apparat/pipelines/`), and smoke fixtures (`pipelines/`). One paragraph, three bullets.
3. **Audit `src/` subdirs for cohesion** — `src/attractor/` (engine), `src/cli/` (CLI + Ink TUI), `src/daemon/` (background runner), `src/lib/` (shared utilities). The boundary between `src/cli/lib/` and `src/lib/` is worth reviewing — shared utilities split across two `lib/` folders is a future confusion point.
