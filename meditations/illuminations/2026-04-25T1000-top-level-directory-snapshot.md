---
date: 2026-04-25
status: archived
description: Top-level source directory inventory as of 2026-04-25, cataloguing the eight primary folders and their roles.
archived_at: 2026-04-25
reason: Reference snapshot proposes no actionable change so triage cannot produce a plan
---

## Core Idea

The project has eight top-level directories, each with a distinct role. Understanding their boundaries is prerequisite to any structural work.

## Why It Matters

New contributors and agents alike orient from the root. Without a current snapshot, prior illuminations (e.g. `2026-04-14T2200`, `2026-04-15T1200`, `2026-04-17T1200`) risk being cited against stale structure. This snapshot supersedes them.

## Top-Level Directory Inventory

| Directory | Role |
|---|---|
| `src/` | All TypeScript source: `cli/` (commands, components, MCP server), `attractor/` (pipeline engine), `daemon/` (heartbeat), `lib/` (shared), `types/` |
| `docs/` | Human and agent documentation: harness guides, orientation, design specs and reviews |
| `specs/` | Canonical feature specs (architecture, commands, pipeline, meditate, etc.) — stable reference layer |
| `pipelines/` | `.dot` pipeline graphs, JSON schemas, scripts, smoke tests, and pipeline integration tests |
| `meditations/` | Meta-meditations (thematic lenses) and `illuminations/` subfolder (this file's home) |
| `scenario-tests/` | Shell-script integration tests for CLI commands and attractor pipeline |
| `memory/` | Persistent cross-session notes written by the memory-writer agent |
| `scripts/` | One-off maintenance scripts (`audit-tool-nodes.mjs`, `backfill-plan-frontmatter.sh`) |

Root-level files of note: `CLAUDE.md`, `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `PROMPT_build.md`, `PROMPT_plan.md`, `package.json`, `tsup.config.ts`, `vitest.config.ts`.

## Revised Implementation Steps

1. No action required — this is a reference illumination, not a change proposal.
2. If the directory structure changes materially (new top-level folder, major subfolder promoted), write a replacement illumination rather than amending this one.
3. Treat `specs/` and `docs/superpowers/specs/` as distinct: `specs/` is canonical and stable; `docs/superpowers/specs/` holds design documents written during feature planning sessions.
