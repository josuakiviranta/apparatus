---
date: 2026-04-12
status: open
description: A map of the top-level source directories in ralph-cli, showing where code, docs, tests, pipelines, and specs live.
---

## Core Idea

ralph-cli organizes its work across eight top-level directories plus a handful of root-level config files. The split between `src/`, `specs/`, `docs/`, `pipelines/`, `scenario-tests/`, `meditations/`, and `memory/` reflects a project that treats documentation, test infrastructure, and agent reflection as first-class citizens alongside source code.

## Why It Matters

Understanding where things live is a prerequisite for everything else. Developers new to this codebase will reach for `src/` first and miss that the canonical behavioral specs live in `specs/`, the pipeline definitions live in `pipelines/`, and the agent-facing prompts live in `src/cli/prompts/`. The `tsx-501/` directory at the root is currently unexplained noise — ~50 hash-named files that suggest a debugging artifact or cache dump that was never cleaned up.

## Top-Level Directory Map

| Directory | Purpose |
|---|---|
| `src/` | All TypeScript source: `cli/`, `attractor/`, `daemon/`, `lib/`, `types/` |
| `specs/` | Behavioral specs per subsystem (architecture, commands, daemon, meditate, etc.) |
| `docs/` | Harness docs + superpowers specs and design reviews |
| `pipelines/` | `.dot` pipeline definitions + JSON schemas; `smoke/` subdirectory for smoke tests |
| `scenario-tests/` | Shell-based end-to-end scenario tests per command |
| `meditations/` | Curated lenses (meta-meditations) + `illuminations/` subfolder |
| `memory/` | Session memory written by Claude agents across conversations |
| `tsx-501/` | Unknown — ~50 hash-named files; likely a debugging artifact, should be investigated and cleaned |

## Revised Implementation Steps

1. Investigate `tsx-501/` — determine what generated these files and whether they should be in `.gitignore` or deleted entirely.
2. Add a `CODEBASE.md` or expand `README.md` with the directory map above so first-time contributors know where to look.
3. Verify that `specs/` and `docs/superpowers/specs/` are not duplicating the same information — the two locations could cause confusion about which is authoritative.
