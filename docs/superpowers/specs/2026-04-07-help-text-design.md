# Help Text Redesign

**Date:** 2026-04-07
**Status:** Approved

## Problem

`ralph --help` currently shows one-liner descriptions and no usage examples. A new user cannot determine the typical workflow, what commands actually do, or how to invoke them with the right arguments.

## Solution

Improve help text in `program.ts` and `heartbeat.ts` using Commander's `.addHelpText('after', ...)` for example blocks and improved `.description()` strings for all commands. No new files, no new abstractions.

## Files Changed

| File | Change |
|------|--------|
| `src/cli/program.ts` | Improved descriptions; `addHelpText('after', ...)` on root program and each command |
| `src/cli/commands/heartbeat.ts` | Improved descriptions on all subcommands; `addHelpText('after', ...)` on heartbeat group and subcommands |

## Root Help After-Text

Appears below the command list when running `ralph --help`:

```
Getting started (typical workflow):
  ralph new my-app                        Scaffold a new project in ./my-app/
  ralph plan my-app                       Open an interactive planning session
  ralph implement my-app                  Run the agentic build loop (Ctrl-C to stop)
  ralph implement my-app --max 3          Run at most 3 iterations
  ralph run-scenarios my-app              Discover and run scenario tests

Background scheduling (heartbeat):
  ralph heartbeat meditate my-app --every 30        Run meditate on my-app every 30 min
  ralph heartbeat list                              Show all scheduled tasks
  ralph heartbeat logs meditate:my-app --follow     Stream live logs for a task
  ralph heartbeat watch                             Live TUI dashboard
  ralph heartbeat pause meditate:my-app             Suspend scheduling without removing
  ralph heartbeat resume meditate:my-app            Re-enable a paused task
  ralph heartbeat stop meditate:my-app              Remove task and kill any running session

Meditation (restricted insight sessions):
  ralph meditate my-app                   Run a one-shot meditation session
  ralph meditate create my-app            Create a new meditation script
```

## Command Description Improvements

### Top-level commands

| Command | Before | After |
|---------|--------|-------|
| `plan` | "Open an interactive Claude planning session" | "Open an interactive Claude session to write specs, README, and build prompts" |
| `implement` | "Run the agentic implementation loop" | "Run the agentic build loop — Claude reads prompts, writes code, commits, and pushes" |
| `new` | "Scaffold a new project and launch a kickoff session" | "Create a new project folder with prompts, specs/, and a guided Claude kickoff session" |
| `meditate` | "Meditation commands" | "Run a restricted Claude session that writes insights to meditations/illuminations/" |
| `meditate create` | "Create a new meditation script" | "Create a new meditation script with a guided Claude session" |
| `run-scenarios` | "Discover and run scenario tests, writing actionable reports" | "Discover scenario-tests/*.md files, run them with Claude, and write reports to scenario-runs/" |
| `heartbeat` | "Manage background scheduled tasks" | "Manage background scheduled tasks (daemon-backed; persists across terminal sessions)" |

### Heartbeat subcommands

| Subcommand | Before | After |
|------------|--------|-------|
| `heartbeat meditate` | "Run meditate on a project folder on a heartbeat schedule" | "Schedule meditate to run on a project folder at a fixed interval" |
| `heartbeat list` | "List all registered heartbeat tasks" | "List all registered tasks with their status and last run time" |
| `heartbeat stop` | "Remove task and kill any running session" | "Remove a task from the schedule and kill any running session" |
| `heartbeat pause` | "Suspend scheduling without removing the task" | "Suspend scheduling for a task without removing it" |
| `heartbeat resume` | "Re-enable scheduling for a paused task" | "Re-enable scheduling for a paused task" |
| `heartbeat kill` | "Kill running session only — schedule stays" | "Kill the currently running session for a task; schedule is preserved" |
| `heartbeat logs` | "Print logs for a task" | "Print logs for a task; use --follow to stream live output" |
| `heartbeat watch` | "Live TUI: all tasks + streaming output" | "Open a live TUI dashboard showing all tasks and streaming output" |

## Per-Command After-Text

Each command gets a short example block shown when the user runs `ralph <command> --help`.

| Command | Examples |
|---------|---------|
| `implement` | `ralph implement my-app` / `ralph implement my-app --max 5` |
| `run-scenarios` | `ralph run-scenarios my-app` / `ralph run-scenarios my-app --all` |
| `heartbeat` | `ralph heartbeat list` / `ralph heartbeat watch` |
| `heartbeat meditate` | `ralph heartbeat meditate my-app --every 30` |
| `heartbeat logs` | `ralph heartbeat logs meditate:my-app` / `ralph heartbeat logs meditate:my-app --follow` |
| `heartbeat stop` | `ralph heartbeat stop meditate:my-app` |
| `heartbeat pause` | `ralph heartbeat pause meditate:my-app` |
| `heartbeat resume` | `ralph heartbeat resume meditate:my-app` |
| `heartbeat kill` | `ralph heartbeat kill meditate:my-app` |

## Testing

Manual: run `ralph --help`, `ralph implement --help`, `ralph heartbeat --help`, `ralph heartbeat meditate --help`, `ralph heartbeat logs --help` and verify the output matches the content above.
