---
date: 2026-04-17
status: open
description: Snapshot of top-level source directories as of 2026-04-17, for orientation in future sessions.
---

## Core Idea

As of 2026-04-17, ralph-cli has seven meaningful top-level directories. Each has a clear domain boundary. No obvious overlap or misplacement was found at the top level.

## Why It Matters

This is the third top-level directory illumination (see `2026-04-14T2200`, `2026-04-15T1200`). The structure has stabilized. Future sessions can orient from this snapshot without re-traversing.

## Revised Implementation Steps

The directories, in dependency order:

1. **`src/`** — All TypeScript source. Three subdomain roots: `attractor/` (pipeline engine), `cli/` (commands, components, MCP server), `daemon/` (heartbeat runner). Also `lib/` (shared daemon client) and `types/` (globals).
2. **`pipelines/`** — DOT pipeline definitions consumed by ralph itself (illumination-to-implementation, illumination-to-plan, poc-implement). Includes `schemas/`, `scripts/`, and `smoke/` subdirectories.
3. **`scenario-tests/`** — Shell-based integration tests that exercise the full CLI binary end-to-end.
4. **`specs/`** — Markdown architecture specs: commands, daemon, heartbeat, loop, MCP illumination, meditate, stream-formatter, run-scenarios.
5. **`docs/`** — Design docs (`superpowers/specs/`), code reviews, harness guide (`harness/tmux-drive.md`), and orientation notes.
6. **`meditations/`** — Meta-meditation lenses (`*.md` at root) and all written illuminations (`illuminations/`).
7. **`memory/`** — Session memory files written by Claude Code across conversations.
