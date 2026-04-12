---
date: 2026-04-12
description: Flat inventory of every top-level directory in ralph-cli and its role, for fast orientation at session start.
---

## Core Idea

ralph-cli has eight top-level directories, each with a distinct role. Knowing what lives where eliminates the orientation tax at the start of every session. The split between `src/`, `specs/`, `docs/`, and `pipelines/` reflects a project that treats design artifacts as first-class citizens alongside code.

## Why It Matters

New sessions (human or agent) waste time re-discovering the layout. A prior illumination (`2026-04-14T0500-top-level-directory-map.md`) exists but this entry is a clean, current snapshot reflecting the state after the handler-context refactor (v0.1.11).

## Top-Level Directory Map

| Directory | Role |
|---|---|
| `src/` | All TypeScript source. Three sub-roots: `cli/` (commands, components, lib, mcp), `attractor/` (pipeline engine, handlers, interviewer), `daemon/` (background scheduler + socket). |
| `docs/` | Human-facing design specs (`superpowers/specs/`), code-review records (`superpowers/reviews/`), and the tmux harness guide (`harness/`). |
| `specs/` | Authoritative feature specs (`architecture.md`, `commands.md`, `meditate.md`, etc.). Source of truth for what each subsystem is supposed to do. |
| `pipelines/` | `.dot` pipeline definitions (smoke tests, real workflows), JSON output schemas, and the `smoke/` sub-folder for CI-level pipeline fixtures. |
| `meditations/` | Meta-meditation lenses (`.md` pattern files) and the `illuminations/` sub-folder where this file lives. |
| `scenario-tests/` | Shell-based integration tests that drive the CLI end-to-end, organized by feature. Complement to vitest unit/component tests in `src/`. |
| `memory/` | Claude auto-memory files persisted across sessions. Contains session logs and architectural decisions. |
| `.claude/` | Local Claude Code settings (`settings.local.json`). Not checked in — machine-local only. |

## Revised Implementation Steps

1. When starting any new feature, check `specs/` first — the spec likely already exists.
2. When adding a pipeline, place `.dot` files under `pipelines/smoke/` (CI fixtures) or `pipelines/` root (production workflows); add output schemas to `pipelines/schemas/`.
3. When adding a CLI command, touch `src/cli/commands/`, register in `src/cli/program.ts`, add agent prompt to `src/cli/agents/`, and write tests in `src/cli/tests/`.
4. When adding an attractor handler, place implementation in `src/attractor/handlers/`, register in `registry.ts`, add tests in `src/attractor/tests/`.
5. When debugging the Ink TUI, consult `docs/harness/tmux-drive.md` before writing any tmux commands.
