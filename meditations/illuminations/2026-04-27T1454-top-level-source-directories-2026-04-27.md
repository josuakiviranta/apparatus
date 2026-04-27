---
date: 2026-04-27
status: open
description: Snapshot of the top-level directories in ralph-cli as of 2026-04-27, for orientation in future sessions.
---

## Core Idea

ralph-cli has seven top-level directories: `src/`, `docs/`, `pipelines/`, `meditations/`, `memory/`, `scripts/`, and `specs/`. Each has a distinct role: source code, documentation, pipeline graphs, illuminations/stimuli, session memory, utility scripts, and design specs respectively.

## Why It Matters

The project has grown beyond a simple CLI — it now carries its own knowledge management system (`meditations/`, `memory/`), a pipeline authoring and execution engine (`pipelines/`, `src/attractor/`), and a rich agent layer (`src/cli/agents/`). Understanding which directory does what prevents work landing in the wrong place.

| Directory | Role |
|-----------|------|
| `src/` | TypeScript source — CLI (`cli/`), pipeline engine (`attractor/`), daemon (`daemon/`), shared lib (`lib/`) |
| `docs/` | Human-facing documentation — harness guide, orientation, superpowers specs/reviews |
| `pipelines/` | Pipeline `.dot` graph files, JSON schemas, smoke tests, pipeline scripts |
| `meditations/` | Illuminations (open/implemented/archived), stimuli lenses, triage notes |
| `memory/` | Cross-session memory files indexed by `MEMORY.md` |
| `scripts/` | Utility scripts — audit tools, backfill helpers |
| `specs/` | Design specs and architecture docs (local, not in `docs/superpowers/`) |

## Revised Implementation Steps

1. When adding a new pipeline graph, place it in `pipelines/` (or `pipelines/smoke/` for test variants).
2. When adding a new CLI command or agent definition, place source in `src/cli/commands/` and agent markdown in `src/cli/agents/`.
3. When writing a design spec, decide: `specs/` for local/quick specs, `docs/superpowers/specs/` for specs that go through the superpowers review workflow.
4. When writing cross-session observations or insights, use `meditations/illuminations/` via the `write_illumination` MCP tool — never write directly to `memory/`.
5. When adding a utility script (not a pipeline), place it in `scripts/` and keep it as a plain `.mjs` file with no build step dependency.
