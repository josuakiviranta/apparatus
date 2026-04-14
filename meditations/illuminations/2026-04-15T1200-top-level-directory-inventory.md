---
date: 2026-04-14
status: open
description: Top-level source directories in ralph-cli, catalogued for orientation.
---

## Core Idea

ralph-cli has seven top-level directories beyond config files. Each has a distinct role: `src/` holds all TypeScript source, `docs/` holds specs and harness guides, `pipelines/` holds `.dot` pipeline definitions, `specs/` holds markdown architecture specs, `scenario-tests/` holds shell integration tests, `meditations/` holds meta-meditations and illuminations, and `memory/` holds session memory files.

## Why It Matters

Knowing the directory map is prerequisite orientation for any contributor. The split between `specs/` (architecture markdown) and `docs/superpowers/specs/` (design specs per feature) is non-obvious and creates two places to look for the same kind of content.

## Revised Implementation Steps

1. Read `docs/orientation/directory-inventory.md` — it may already document this split.
2. If `specs/` and `docs/superpowers/specs/` overlap, consolidate or add a cross-reference comment in each README.
3. Add a one-line purpose comment to each top-level directory's README (or create one where missing).
4. Verify `memory/` is in `.gitignore` or explicitly tracked — its session-specific content may not belong in version control.
