# Commands

All commands are registered in `src/cli/program.ts` via Commander.

## `ralph plan <project-folder>`

Opens an interactive Claude planning session.

**Behavior:**
1. Non-interactive kickoff phase: spawns `claude -p --output-format=stream-json` to capture a session ID
2. Interactive resume phase: spawns `claude --resume <session-id>` in the project folder as an interactive TUI

No prompt files required — injects a brainstorm trigger prompt directly.

## `ralph implement <project-folder>`

Runs the agentic implementation loop.

**Options:**
- `--max <n>` — cap the number of loop iterations (default: unlimited)

**Behavior:**
1. Resolves absolute path; exits if folder missing
2. Calls `bootstrapPrompts()` — if prompts were injected, exits with instructions to review
3. Delegates to `runLoop({ promptFile: PROMPT_build.md, cwd, max })` from `loop.ts`

See [loop.md](loop.md) for iteration details, signal handling, and git push behavior.

## `ralph new <project-name>`

Scaffolds a new project and launches a kickoff session.

**Behavior:**
1. Conflict check: warns and exits if `./project-name/` already exists
2. Creates directory scaffold:
   - `specs/`
   - `src/`
   - `scenario-tests/`
   - `scenario-runs/`
   - Empty files: `README.md`, `AGENTS.md`, `IMPLEMENTATION_PLAN.md`
   - Copies bundled `PROMPT_plan.md` and `PROMPT_build.md`
   - `.gitignore` with `PROMPT_*.md`, `IMPLEMENTATION_PLAN.md`
3. Runs `git init -b main`
4. Two-phase kickoff session using bundled `PROMPT_kickoff.md`:
   - Phase 1: Non-interactive — substitutes `{{PROJECT_NAME}}`, Claude writes `README.md` + `specs/README.md`
   - Phase 2: Interactive TUI resume for user to refine

## `ralph meditate <project-folder>`

Launches a sandboxed meditation Claude session.

**Behavior:**
1. Validates project folder exists
2. Writes PID lock file at `<project-folder>/.ralph-meditate.pid`
3. Writes per-PID MCP config for the illumination server
4. Spawns Claude with strict `dontAsk` permissions:
   - `Read` — globally allowed
   - `Write` — restricted to `meditations/illuminations/` only
5. Claude runs as an interactive session with MCP illumination server access

**Stopping:** Press `Ctrl-C` on the running session, or use `ralph heartbeat stop meditate:<project>` for scheduled sessions. Signal handlers clean up the PID lock file and MCP config automatically.

## `ralph meditate create <project-folder>`

Creates a new meditation script via a non-interactive Claude session.

**Behavior:**
1. Spawns a non-interactive Claude session to generate meditation topics
2. No PID lock file, no permission restrictions
3. Result is stored in the project's meditation directory

## `ralph run-scenarios <project-folder> [--all]`

Discovers and runs scenario tests.

**Options:**
- `--all` — skip interactive selection, run every discovered scenario

**Behavior:**
1. Discovers scenario scripts in `<project-folder>/scenario-tests/*.md`
2. Without `--all`: presents interactive multi-select for which scenarios to run
3. With `--all`: runs every discovered scenario
4. Each scenario runs as an isolated non-interactive Claude session with a templated prompt
5. Timestamped results written to `<project-folder>/scenario-runs/`
6. Claude interprets the output and writes an actionable report

## `ralph heartbeat` (subcommands)

Schedules recurring tasks via the background daemon. Communicates via RPC (no direct Claude invocation).

### `ralph heartbeat meditate <folder> --every <n>`

Registers a recurring meditation task to run every `<n>` minutes. The daemon auto-starts if not already running.

### `ralph heartbeat implement <folder> --every <n>`

Registers a recurring implement loop to run every `<n>` minutes.

### `ralph heartbeat run-scenarios <folder> --every <n>`

Registers recurring scenario tests to run every `<n>` minutes.

### `ralph heartbeat pipeline <dotfile> --every <n> [--project <folder>]`

Registers a recurring DOT-graph pipeline. Task ID is computed as `pipeline:<dotfile-stem>` (e.g. `pipeline:smoke` for `smoke.dot`). The optional `--project` flag passes a project folder to the pipeline.

### `ralph heartbeat list`

Lists all registered heartbeat tasks with their status and last run time.

### `ralph heartbeat stop <task-id>`

Stops and removes a registered heartbeat task, killing any running session.

### `ralph heartbeat pause <task-id>`

Suspends scheduling for a task without removing it.

### `ralph heartbeat resume <task-id>`

Re-enables scheduling for a paused task.

### `ralph heartbeat kill <task-id>`

Kills a currently running session for a task (schedule is preserved).

### `ralph heartbeat logs <task-id> [--follow]`

Shows logs for a heartbeat task. `--follow` streams new log lines in real-time.

### `ralph heartbeat watch`

Real-time TUI dashboard of all heartbeat tasks.

## Git Push Behavior

After each loop iteration, `loop.ts` pushes changes:
1. `git push origin <branch>` (via `spawnSync`)
2. On failure: retry with `git push -u origin <branch>`
3. On second failure: log warning, continue looping

## Error Handling

| Condition | Command | Behavior |
|-----------|---------|----------|
| Project folder missing | `implement`, `meditate`, `run-scenarios` | Exit with error |
| Project folder already exists | `new` | Warn and exit |
| Prompt file missing | `implement` (via loop) | Throws error |
| `claude` not in PATH | `implement` (via loop) | Throws error |
| Claude exits non-zero | `implement` (via loop) | `log.warn()`, loop continues |
| `git push` fails twice | `implement` (via loop) | `log.warn()`, loop continues |
| No scenarios found | `run-scenarios` | Exit with message |
| Daemon not running | `heartbeat` subcommands | Auto-starts daemon |
