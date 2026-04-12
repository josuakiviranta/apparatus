# Design: Top-Level Directory Inventory (Session Orientation Reference)

**Date:** 2026-04-12
**Status:** Approved
**Supersedes:** Complements `2026-04-12-top-level-directory-map-design.md` (README cleanup). This document focuses on the orientation reference itself.

## Problem

New sessions (human or agent) waste time re-discovering the ralph-cli layout. The codebase has eight top-level directories plus five sub-roots inside `src/`, but no single document captures both the directory roles and the practical "where do I put X?" rules. The prior directory-map design addresses adding a table to README.md; this document captures the full inventory with implementation-step guidance for ongoing development.

## Solution

A flat inventory of all top-level directories with their roles, combined with actionable implementation steps for common tasks (adding commands, handlers, pipelines, specs). This serves as a fast-orientation reference that can be consulted at session start.

## Architecture

### Directory Inventory

| Directory | Role |
|---|---|
| `src/` | All TypeScript source. Five sub-roots: `cli/` (commands, components, lib, mcp, agents, prompts, tests), `attractor/` (pipeline engine, handlers, core, transforms, tests), `daemon/` (background scheduler + socket), `lib/` (shared utilities), `types/` (ambient type declarations). |
| `docs/` | Human-facing design specs (`superpowers/specs/`), code-review records (`superpowers/reviews/`), implementation plans (`superpowers/plans/`), and the tmux harness guide (`harness/`). |
| `specs/` | Authoritative feature specs (`architecture.md`, `commands.md`, `meditate.md`, etc.). Source of truth for what each subsystem is supposed to do. |
| `pipelines/` | `.dot` pipeline definitions (smoke tests, real workflows), JSON output schemas (`schemas/`), and the `smoke/` sub-folder for CI-level pipeline fixtures. |
| `meditations/` | Meta-meditation lenses (`.md` pattern files) and the `illuminations/` sub-folder for generated insights. |
| `scenario-tests/` | Shell-based integration tests that drive the CLI end-to-end, organized by feature. Complement to vitest unit/component tests in `src/`. |
| `memory/` | Claude auto-memory files persisted across sessions. Contains session logs and architectural decisions. |
| `.claude/` | Local Claude Code settings (`settings.local.json`). Not checked in -- machine-local only. |

### src/ Sub-Root Detail

| Sub-root | Contents |
|---|---|
| `cli/` | `commands/`, `components/`, `lib/`, `mcp/`, `agents/`, `prompts/`, `tests/` |
| `attractor/` | `handlers/`, `core/`, `transforms/`, `tests/` |
| `daemon/` | Background scheduler + socket server |
| `lib/` | Shared utilities used across cli, attractor, and daemon |
| `types/` | Ambient type declarations (`globals.d.ts`) |

## Components

| Component | Purpose |
|---|---|
| Directory inventory table | Maps each top-level directory to its role |
| src/ sub-root table | Breaks down the five sub-roots inside src/ |
| Implementation steps | Actionable rules for where to place new code |

## Data Flow

No runtime data flow. This is a reference document that informs developer/agent workflow decisions:

```
Session start --> Consult inventory --> Locate correct directory --> Begin work
```

## Implementation Steps (Where to Put Things)

1. **New feature:** Check `specs/` first -- the spec likely already exists.
2. **New pipeline:** Place `.dot` files under `pipelines/smoke/` (CI fixtures) or `pipelines/` root (production workflows); add output schemas to `pipelines/schemas/`.
3. **New CLI command:** Touch `src/cli/commands/`, register in `src/cli/program.ts`, add agent prompt to `src/cli/agents/`, write tests in `src/cli/tests/`.
4. **New attractor handler:** Place implementation in `src/attractor/handlers/`, register in `registry.ts`, add tests in `src/attractor/tests/`.
5. **Debugging Ink TUI:** Consult `docs/harness/tmux-drive.md` before writing any tmux commands.

## Constraints

- **Accuracy over completeness:** The inventory lists what exists now (post v0.1.11 handler-context refactor). It must be updated when top-level structure changes.
- **No runtime impact:** This is purely a documentation/orientation artifact.
- **src/ has five sub-roots, not three:** Earlier references to "three sub-roots" are outdated. `lib/` and `types/` are first-class sub-roots.
- **specs/ vs docs/superpowers/specs/:** These are complementary -- `specs/` holds current authoritative behavioral specs; `docs/superpowers/specs/` holds design history and brainstorm artifacts.

## Files to Modify

None. This design document is self-contained as a reference. The README.md directory table is covered by the companion design (`2026-04-12-top-level-directory-map-design.md`).
