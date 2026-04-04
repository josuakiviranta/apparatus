# CLI Help Readability Design

**Date:** 2026-04-04
**Status:** Approved

## Problem

`ralph --help` is hard to read and incomplete:

- A positional shorthand (`ralph <folder> [plan|implement]`) creates a dual mental model
- `--max` appears at the root level but only applies to `implement`
- `meditate` subcommands are hidden behind manual if/else dispatch — users can't discover `add`, `stop`, `status`, `kill` without reading source code
- `meditate add` is poorly named for what it does (kickoff a two-phase session to create a new meditation script)
- `meditate kill` and `meditate stop` have confusing names (kill sounds more destructive but is actually softer)

## Design

### Mental model

All commands follow a single pattern: `ralph <command> <folder>`. No positional shorthands.

### Remove positional shorthand

Delete lines 62–77 in `src/cli/index.ts` (the `ralph <folder> [plan|implement]` fallback). Users must use explicit commands.

### Flatten meditate subcommands

Instead of a nested Commander command group, register all meditate subcommands as top-level multi-word commands (e.g. `program.command('meditate stop <project-folder>')`). Commander lists them naturally in `ralph --help`, making the full surface discoverable without a second help invocation.

### Rename commands

- `meditate add` → `meditate create` (creates a new meditation script via two-phase Claude session)
- `meditate kill` → removed (see below)

### Consolidate stop/kill into one command

`meditate kill` (kill session, keep cron) is removed. `meditate stop` is the single shutdown command: removes cron entry, sends SIGTERM to the running session, and cleans up all artifacts.

**Stop must also handle stale state:** if the stored PID is dead (process crashed, system reboot), `meditate stop` should still remove the cron entry, sentinel file, PID file, and any orphaned `.mcp.ralph-*.json` files in the project folder — rather than reporting "no active session" and leaving artifacts behind.

### Resulting command surface

```
ralph plan <project-folder>              Open an interactive Claude planning session
ralph implement <project-folder>         Run the agentic implementation loop
ralph new <project-name>                 Scaffold a new project and launch a kickoff session
ralph meditate <project-folder>          Run a meditation cycle
ralph meditate create <project-folder>   Create a new meditation script
ralph meditate stop <project-folder>     Stop schedule and any running session
ralph meditate status <project-folder>   Show meditation schedule and session status
```

### Expected `ralph --help` output

```
Usage: ralph [options] [command]

Agentic loop runner for AI-assisted project development

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  plan <project-folder>              Open an interactive Claude planning session
  implement <project-folder>         Run the agentic implementation loop
  new <project-name>                 Scaffold a new project and launch a kickoff session
  meditate <project-folder>          Run a meditation cycle
  meditate create <project-folder>   Create a new meditation script
  meditate stop <project-folder>     Stop schedule and any running session
  meditate status <project-folder>   Show meditation schedule and session status
  help [command]                     display help for command
```

`--max` appears only under `ralph implement --help`.

## Files to change

- `src/cli/index.ts` — remove positional shorthand block; replace meditate if/else with flat Commander commands; rename `meditate add` → `meditate create`; remove `meditate kill` registration
- `src/cli/commands/meditate-add.ts` → `src/cli/commands/meditate-create.ts` — rename file and exported function (`meditateAddCommand` → `meditateCreateCommand`)
- `src/cli/commands/meditate.ts` — remove `meditateKill` export; harden `meditateStop` to clean up stale artifacts (dead PID, orphaned MCP config files) even when no session is running

## Stop cleanup contract

`meditateStop` must always:
1. Remove the cron entry (if sentinel exists)
2. Remove the sentinel file
3. Send SIGTERM to the stored PID if the process is alive
4. Remove the PID file
5. Glob and remove any `.mcp.ralph-*.json` files in the project folder (handles orphaned configs from crashed sessions)

Steps 1–5 run regardless of whether a live session is found.
