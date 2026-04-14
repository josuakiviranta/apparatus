---
date: 2026-04-13
status: open
description: The project has six top-level source areas: src/, docs/, pipelines/, specs/, scenario-tests/, and meditations/ — each with a distinct role that maps to a layer of the system.
---

## Core Idea

ralph-cli organizes its source across six top-level directories, each with a distinct role. `src/` holds all TypeScript (CLI, attractor engine, daemon, MCP server). `docs/` holds design specs and harness guides. `pipelines/` holds `.dot` workflow graphs and their JSON schemas. `specs/` holds human-readable feature specifications. `scenario-tests/` holds shell-based integration tests. `meditations/` holds meta-meditations and the illuminations log.

## Why It Matters

Knowing these six areas prevents contributors from misplacing work. New pipeline schemas go in `pipelines/schemas/`, not `src/`. Feature specs belong in `specs/` or `docs/superpowers/specs/`, not scattered in `src/`. The distinction between `docs/superpowers/specs/` (design artifacts) and `specs/` (living feature specs) is subtle and currently undocumented in any orientation file — only `docs/orientation/directory-inventory.md` partially covers it.

## Revised Implementation Steps

1. Read `docs/orientation/directory-inventory.md` to check whether all six top-level dirs are described.
2. If gaps exist, add a one-paragraph entry per missing directory explaining its role and what belongs there.
3. Add a rule to `CLAUDE.md` or `AGENTS.md`: where new files go for each directory (pipeline graphs → `pipelines/`, specs → `specs/`, design docs → `docs/superpowers/specs/`).
4. Verify `pipelines/smoke/` and `pipelines/schemas/` are both referenced in the orientation doc, since smoke test pipelines and schema files serve different audiences.
5. Consider moving the `memory/` directory (currently inside the project root) to `docs/` or noting explicitly that it is agent-session memory, not project documentation.
