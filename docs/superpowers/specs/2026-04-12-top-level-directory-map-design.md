# Design: Top-Level Directory Map in README.md

**Date:** 2026-04-12
**Status:** Approved

## Problem

ralph-cli has eight top-level directories but no orientation guide. Developers new to the codebase reach for `src/` and miss that behavioral specs live in `specs/`, pipeline definitions in `pipelines/`, and agent prompts in `src/cli/prompts/`. The `tsx-501/` directory at the root is ~49 hash-named files — a debugging artifact that was never cleaned up. There is also potential confusion between `specs/` and `docs/superpowers/specs/` since both contain spec-like content.

## Solution

Three actions, scoped to be minimal and non-disruptive:

1. **Investigate and clean `tsx-501/`** — determine what generated the files; delete or `.gitignore` them.
2. **Add a directory map table to `README.md`** — keep it compact (one table, not a verbose guide). No new files.
3. **Add a one-line clarifying note** in the directory table explaining `specs/` vs `docs/superpowers/specs/` — they are complementary (`specs/` = current behavioral specs, `docs/superpowers/specs/` = design history), not duplicates.

## Architecture

### README.md — Directory Map Section

A new `## Directory Map` section added to the existing `README.md`. Format:

```markdown
## Directory Map

| Directory | Purpose |
|---|---|
| `src/` | All TypeScript source: `cli/`, `attractor/`, `daemon/`, `lib/`, `types/` |
| `specs/` | Behavioral specs per subsystem (current, authoritative) |
| `docs/` | Harness docs + `superpowers/specs/` (design history, not authoritative specs) |
| `pipelines/` | `.dot` pipeline definitions + JSON schemas; `smoke/` for smoke tests |
| `scenario-tests/` | Shell-based end-to-end scenario tests per command |
| `meditations/` | Curated lenses (meta-meditations) + `illuminations/` subfolder |
| `memory/` | Session memory written by Claude agents across conversations |
```

The `tsx-501/` row is intentionally omitted — it will be cleaned up, not documented.

### tsx-501/ Cleanup

1. Inspect file contents and creation timestamps to identify the source (likely a `tsx` runner cache or temp output).
2. If confirmed as artifact: delete the directory and add `tsx-*` or the specific pattern to `.gitignore`.
3. If any files are needed: move to an appropriate location and document.

## Components

| Component | Action |
|---|---|
| `README.md` | Add `## Directory Map` table with 7 rows + clarifying note on specs vs design docs |
| `tsx-501/` | Investigate, then delete or `.gitignore` |
| `.gitignore` | Add exclusion pattern if `tsx-501/` is a reproducible cache |

## Data Flow

No runtime data flow changes. This is a documentation-only change with a cleanup side-effect.

## Constraints

- **No new files** — the map goes in `README.md`, not a separate `CODEBASE.md`.
- **Minimal presentation** — a single markdown table, not a verbose walkthrough.
- **No other file modifications** — only `README.md`, `.gitignore`, and the `tsx-501/` cleanup.
- The clarifying note about `specs/` vs `docs/superpowers/specs/` is a single line, not a paragraph.

## Files to Modify

| File | Change |
|---|---|
| `README.md` | Add `## Directory Map` section with table and one-line specs clarification |
| `.gitignore` | Add `tsx-*` or equivalent pattern (if `tsx-501/` is a reproducible artifact) |
| `tsx-501/` | Delete directory after investigation confirms it is safe to remove |
