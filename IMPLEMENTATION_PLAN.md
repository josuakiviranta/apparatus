# CLI Help Readability Implementation Plan

> **Status:** All chunks COMPLETE (tag 0.0.10)

**Goal:** Make `ralph --help` show all commands and subcommands clearly, standardize to `ralph <command> <folder>` mental model, and remove dead/confusing command surface.

**Architecture:** Three focused changes — rename meditate-add → meditate-create, harden meditateStop and remove meditateKill, then rewire index.ts to use flat Commander commands with the positional shorthand removed.

**Tech Stack:** TypeScript, Commander.js, Vitest

**Spec:** `docs/superpowers/specs/2026-04-04-cli-help-readability-design.md`

---

## Completed Chunks

### Chunk 1: Rename meditate-add → meditate-create ✅
- Renamed `src/cli/commands/meditate-add.ts` → `meditate-create.ts`
- Renamed `src/cli/tests/meditate-add.test.ts` → `meditate-create.test.ts`
- Updated all exported function names (buildMeditateCreateKickoffArgs, meditateCreateCommand)
- Updated AGENTS.md file list reference

### Chunk 2: Harden meditateStop + remove meditateKill ✅
- Rewrote meditateStop to clean up orphaned `.mcp.ralph-*.json` files, stale PID files
- Works even when no sentinel exists (crashed session scenario)
- Removed meditateKill export entirely — meditateStop handles all cleanup
- Added 3 new tests for stale artifact cleanup

### Chunk 3: Update index.ts — flat commands, remove shorthand ✅
- Replaced single `meditate <action-or-folder>` dispatch with flat Commander commands
- Commands: `meditate`, `meditate-create`, `meditate-stop`, `meditate-status`
- Removed positional shorthand block (`ralph <folder> [plan|implement]`)
- All commands visible in `ralph --help` at root level

---

## Notes

- Commander.js doesn't support multi-word commands like `meditate create` alongside `meditate <folder>` — used hyphenated names (`meditate-create`, `meditate-stop`, `meditate-status`) instead
- All 127 tests pass across 6 test files
- Tagged as 0.0.10
