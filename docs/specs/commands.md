# Commands

All commands are registered in `src/cli/program.ts` via Commander.

## `ralph implement <project-folder>`

Runs the agentic implementation loop.

**Options:**
- `--max <n>` — cap the number of loop iterations (default: unlimited)
- `--model <name>` — override the LLM model for the session
- `--scenarios <path>` — relative path under `<project-folder>` for scenario tests. Enables the scenario-author + implementation-tester branch. Requires tmux. Default: branch skipped.

**Behavior:**
1. Resolves absolute path; exits if folder missing
2. Resolves the `implement` agent definition via the agent registry
3. Loops `agent.run()` calls with `onStdout` piped through `streamEvents()` for display
4. Git pushes after each iteration; retries once on failure

See [loop.md](loop.md) for iteration details, signal handling, and git push behavior.

## `ralph meditate <project-folder>`

Launches a meditation pipeline session. This command is a thin shim backed by the bundled `src/cli/pipelines/meditate/` folder pipeline.

**Behavior:**
1. Validates project folder exists.
2. Checks for an already-running meditate session (PID lock at `<project-folder>/.meditate.pid`); exits early if alive.
3. Ensures `meditations/illuminations/` directory exists.
4. Appends meditate-specific entries (`.meditate.json`, `.meditate.pid`, MCP config glob) to `.gitignore` if missing.
5. Writes a PID lock file (`<project-folder>/.meditate.pid`).
6. Calls `resolveBundledPipeline("meditate")` and delegates to `pipelineRunCommand(dotFile, { project, variables: { steer, vision } })`.
7. Removes the PID lock file in a `finally` block.

**`--var steer=<text>` flag:** passes a steering directive into the pipeline context as the `steer` variable. This lets the caller influence which kind of meditation the pipeline runs without modifying the bundled pipeline.

**Stopping:** `Ctrl-C` on the session, or `ralph heartbeat stop meditate:<project>` for scheduled sessions.

## `ralph heartbeat` (subcommands)

Schedules recurring tasks via the background daemon. Communicates via RPC (no direct Claude invocation).

### `ralph heartbeat meditate <folder> --every <n>`

Registers a recurring meditation task to run every `<n>` minutes. The daemon auto-starts if not already running.

### `ralph heartbeat implement <folder> --every <n>`

Registers a recurring implement loop to run every `<n>` minutes.

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

## `ralph pipeline` (subcommands)

Manages DOT-graph pipelines for multi-step workflows.

### `ralph pipeline run <dotfile> [--project <folder>] [--resume] [--var key=value]...`

Runs a DOT-graph pipeline. Each node in the graph is executed by a handler resolved from node attributes (shape, agent, type). The `agent` attribute routes to named agents via the AgentHandler.

**Flags:**
- `--project <folder>` — sets `$project` and the cwd for work nodes. Required in headless mode (cron / non-TTY); cwd is ambiguous otherwise.
- `--var <key>=<value>` — passes a caller variable into the pipeline context (repeatable).
- `--resume [runId]` — resumes from the last checkpoint instead of starting fresh. Bare form auto-selects when exactly one prior run exists for the project; passes a list and exits 1 when more than one exists. Pass an explicit `<runId>` to disambiguate.

**Path layout:**
All per-run state lives at `~/.ralph/<projectKey>/runs/<runId>/`, which holds both `pipeline.jsonl` (the JSONL trace) and `checkpoint.json`. `<projectKey>` is `<basename>-<6 hex chars of sha256(absolute project path)>`; `<runId>` is a fresh 8-char UUID for every run. Tests can override the parent root via `RALPH_RUNS_ROOT`.

**Checkpoint & resume:**
The engine writes `checkpoint.json` after every node advance (success, fail-edge routing, or retry exhaustion). The checkpoint captures the next `currentNode`, `completedNodes`, accumulated `context`, and `nodeRetries`. A fresh run mints a new `<runId>` directory and never overwrites a prior run; older runs are pruned lazily at run-start (last 50 per project, override with `RALPH_RUNS_KEEP=N`). Running with `--resume` loads the resolved checkpoint and continues from the node that was about to execute when the run stopped — this works after Ctrl-C, node failures, or process crashes alike.

**`pipeline trace <runId>`:** accepts an optional `--project <folder>` to pin the lookup to one project. Without it, the runId is resolved by scanning `~/.ralph/*/runs/` across all projects; collision (same runId in multiple projects) is reported as an error.

**Tool-node idempotency requirement:**
Because `--resume` re-executes the node that was interrupted, scripts referenced by tool nodes (`type="tool"` + `script_file=`) must be idempotent. A script that enforces strict input-state invariants (e.g. "state must be X before I can act") will fail on resume when a prior partial attempt already advanced the state. Detect that the desired outcome is already present and exit 0 as a no-op instead. Reference pattern: `pipelines/scripts/mark-dispatched.mjs` — same `plan_path` → idempotent no-op, conflicting `plan_path` → error exit.

**Exit codes:**
- Exits with code 1 on any of the four pre-engine guard failures: the `.dot` file is missing, DOT parsing fails, declared `Graph.inputs` are not satisfied by `--var` or resolved defaults, or the pipeline is marked headless-safe and no TTY is attached.
- Exits with code 0 on engine success (all nodes advanced to an `exit` node without failure).
- Exits with code 1 on engine failure (any node exhausts its retry budget). Scripts that need to detect run failure can parse the JSONL trace at `~/.ralph/<projectKey>/runs/<runId>/pipeline.jsonl`.

**Tool-node `cwd`:** every `type="tool"` node must declare a `cwd=` attribute. The command executes with that directory as cwd.

**`--project` preflight:** if the pipeline references `$project` in any node attribute, `pipeline run` requires `--project <folder>` and exits 1 otherwise with rule `project_binding_missing` (printed to stderr as `[project_binding_missing]`). `--var project=...` does not satisfy this.

**Gate-node choice in context:** every `wait-human` (hexagon) gate that resolves to a user pick writes two keys into pipeline context on success: `<gateNodeId>.choice` — authoritative and immutable for the remainder of the run, safe to reference from any downstream node, condition, or `$var` expansion — and `choice` — an alias that always holds the most-recent resolved gate's pick. Aborted or failed gates write neither key; any prior gate's `<nodeId>.choice` survives intact. Under parallel branches the bare `choice` alias is last-writer-wins and non-deterministic, so prefer `<gateNodeId>.choice` whenever two gates can race. Condition edges read these via the standard `condition="key=value"` syntax; variable expansion reads them as `$<gateNodeId>.choice` or `$choice`.

### `ralph pipeline list [folder]`

Lists available pipeline DOT files in a folder.

### `ralph pipeline validate <dotfile> [--project <folder>]`

Validates the structure of a DOT-graph pipeline without executing any handlers. Accepts either a name shorthand (resolved via `isNameShorthand` + `getPipelinesDir`, matching `run`'s resolution) or a path to a `.dot` file. The `--project <folder>` flag sets the pipelines-dir base for name-shorthand resolution.

The validator checks: missing `start` or `exit` nodes; nodes using unknown shapes; edges referencing undeclared node ids; and `reaches_exit` — every non-exit node must have at least one path to an `exit` node (dead-end detection, added 2026-04-18).

Exit 0 when the graph is valid; exit 1 on any structural error.

### `ralph pipeline trace <runId> [--node-receive <id>] [--full]`

Inspects the JSONL trace from a completed or in-flight pipeline run. Reads `~/.ralph/runs/<runId>/pipeline.jsonl` — the fresh-per-run trace, distinct from the stable `~/.ralph/runs/<slug>/` checkpoint state (see the two-paths note in the `run` section).

Without flags, prints every node invocation with status and a summary of relevant context keys. With `--node-receive <id>`, prints the full context snapshot at that node's invocation plus the list of completed stages up to that point. `--full` disables context-value truncation so long values appear in their entirety.

**Exit codes:**
- Exits 1 if the trace file at `~/.ralph/runs/<runId>/pipeline.jsonl` does not exist.
- Exits 0 on success.

## Git Push Behavior

After each loop iteration, `implement.ts` pushes changes:
1. `git push origin <branch>` (via `spawnSync`)
2. On failure: retry with `git push -u origin <branch>`
3. On second failure: log warning, continue looping

## Error Handling

| Condition | Command | Behavior |
|-----------|---------|----------|
| Project folder missing | `implement`, `meditate` | Exit with error |
| `claude` not in PATH | `implement` (via loop) | Throws error |
| Claude exits non-zero | `implement` (via loop) | `log.warn()`, loop continues |
| `git push` fails twice | `implement` (via loop) | `log.warn()`, loop continues |
| Daemon not running | `heartbeat` subcommands | Auto-starts daemon |
