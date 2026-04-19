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
3. Resolves the `implement` agent definition via the agent registry
4. Loops `agent.run()` calls with `onStdout` piped through `streamEvents()` for display
5. Git pushes after each iteration; retries once on failure

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

## `ralph agent` (subcommands)

Manages agent definitions — markdown files with YAML frontmatter that configure how Claude sessions are spawned.

### `ralph agent list`

Lists all available agents from both user directory (`~/.ralph/agents/`) and bundled defaults. Shows name, model, description, and source (built-in vs custom).

### `ralph agent show <name>`

Displays the full configuration of a named agent including model, permissions, tools, MCP servers, and prompt body.

### `ralph agent create`

Interactive session to collaboratively design a new agent definition. Launches the `agent-creator` agent which guides the user through agent configuration and writes the result to `~/.ralph/agents/<name>.md`.

## `ralph pipeline` (subcommands)

Manages DOT-graph pipelines for multi-step workflows.

### `ralph pipeline run <dotfile> [--project <folder>] [--resume] [--var key=value]...`

Runs a DOT-graph pipeline. Each node in the graph is executed by a handler resolved from node attributes (shape, agent, type). The `agent` attribute routes to named agents via the AgentHandler.

**Flags:**
- `--project <folder>` — sets `$project` and the cwd for work nodes.
- `--var <key>=<value>` — passes a caller variable into the pipeline context (repeatable).
- `--resume` — resumes from the last checkpoint instead of starting fresh.

**Checkpoint & resume:**
The engine writes `~/.ralph/runs/<slug>/checkpoint.json` after every node advance (success, fail-edge routing, or retry exhaustion). The checkpoint captures the next `currentNode`, `completedNodes`, accumulated `context`, and `nodeRetries`. Running without `--resume` wipes `~/.ralph/runs/<slug>/` and starts from the `Mdiamond` start node. Running with `--resume` loads the checkpoint and continues from the node that was about to execute when the run stopped — this works after Ctrl-C, node failures, or process crashes alike.

Two different paths under `~/.ralph/runs/` should not be confused:
- `~/.ralph/runs/<slug>/` — stable across runs for a given pipeline; holds `checkpoint.json` and per-node `status.json`. `<slug>` is `graph.name` lowercased. This is what `--resume` reads.
- `~/.ralph/runs/<runId>/pipeline.jsonl` — fresh `<runId>` (8-char UUID) regenerated every run; holds the JSONL trace. This is the `run:` path printed in the pipeline header and consumed by `ralph pipeline trace`.

**Tool-node idempotency requirement:**
Because `--resume` re-executes the node that was interrupted, scripts referenced by tool nodes (`type="tool"` + `script_file=`) must be idempotent. A script that enforces strict input-state invariants (e.g. "state must be X before I can act") will fail on resume when a prior partial attempt already advanced the state. Detect that the desired outcome is already present and exit 0 as a no-op instead. Reference pattern: `pipelines/scripts/mark-dispatched.mjs` — same `plan_path` → idempotent no-op, conflicting `plan_path` → error exit.

**Exit codes:**
- Exits with code 1 on any of the four pre-engine guard failures: the `.dot` file is missing, DOT parsing fails, declared `Graph.inputs` are not satisfied by `--var` or resolved defaults, or the pipeline is marked headless-safe and no TTY is attached.
- Exits with code 0 on engine success (all nodes advanced to an `exit` node without failure).
- Exits with code 0 on engine failure as well — when a node's retry budget is exhausted the Ink renderer paints `fail`, a post-failure tip suggesting `ralph pipeline refine <name>` is emitted, and the process returns normally. This is a deliberate discoverability choice (see `specs/2026-04-17-refine-run-history-and-failure-tip-design.md`); scripts that need to detect run failure should parse the JSONL trace at `~/.ralph/runs/<runId>/pipeline.jsonl` rather than rely on the exit code.

**Tool-node `cwd`:** every `type="tool"` node must declare a `cwd=` attribute. The command executes with that directory as cwd.

**`--project` preflight:** if the pipeline references `$project` in any node attribute, `pipeline run` requires `--project <folder>` and exits 1 otherwise with rule `project_binding_missing` (printed to stderr as `[project_binding_missing]`). `--var project=...` does not satisfy this.

### `ralph pipeline list [folder]`

Lists available pipeline DOT files in a folder.

### `ralph pipeline validate <dotfile> [--project <folder>]`

Validates the structure of a DOT-graph pipeline without executing any handlers. Accepts either a name shorthand (resolved via `isNameShorthand` + `getPipelinesDir`, matching `run`'s resolution) or a path to a `.dot` file. The `--project <folder>` flag sets the pipelines-dir base for name-shorthand resolution.

The validator checks: missing `start` or `exit` nodes; nodes using unknown shapes; edges referencing undeclared node ids; and `reaches_exit` — every non-exit node must have at least one path to an `exit` node (dead-end detection, added 2026-04-18).

Exit 0 when the graph is valid; exit 1 on any structural error. When invoked internally by `ralph pipeline refine`, the same entry point also accepts a `previousGraph` argument and emits edge-label diff diagnostics via `diffEdgeLabels()`; this is not a user-facing flag.

### `ralph pipeline refine <name> [--project <folder>] [--no-traces]`

Opens an interactive Claude session to refine an existing pipeline. Requires the target `.dot` to already exist (inverse of `create`'s must-not-exist conflict check). The session prompt is built via `composeCreatePrompt()` so the refined graph is aware of project-local agents; up to three recent run-trace digests are injected via `listRecentTraces()` + `digestTraceFile()` to ground refinements in observed behavior. On exit, the previous graph is passed to `pipelineValidateCommand` for an edge-label diff against the refined graph.

**Flags:**
- `--project <folder>` — resolves the pipelines-dir and sets the project scope used by `composeCreatePrompt()`.
- `--no-traces` — suppresses the recent-traces digest block in the prompt (useful when trace noise is misleading the session).

**Exit codes:**
- Exits non-zero if `claude` is not on PATH.
- Exits non-zero if the `.dot` file does not exist after the session completes.
- Otherwise exits with the result of the final `pipelineValidateCommand` call (0 on valid, 1 on structural error).

No post-failure `refine` tip is printed — `refine` is already the target of that tip. See `specs/2026-04-17-refine-run-history-and-failure-tip-design.md` for the shipping-event record.

### `ralph pipeline trace <runId> [--node-receive <id>] [--full]`

Inspects the JSONL trace from a completed or in-flight pipeline run. Reads `~/.ralph/runs/<runId>/pipeline.jsonl` — the fresh-per-run trace, distinct from the stable `~/.ralph/runs/<slug>/` checkpoint state (see the two-paths note in the `run` section).

Without flags, prints every node invocation with status and a summary of relevant context keys. With `--node-receive <id>`, prints the full context snapshot at that node's invocation plus the list of completed stages up to that point. `--full` disables context-value truncation so long values appear in their entirety.

**Exit codes:**
- Exits 1 if the trace file at `~/.ralph/runs/<runId>/pipeline.jsonl` does not exist.
- Exits 0 on success.

### `ralph pipeline create <name>`

Interactive session to create a new pipeline DOT file.

## Git Push Behavior

After each loop iteration, `implement.ts` pushes changes:
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
