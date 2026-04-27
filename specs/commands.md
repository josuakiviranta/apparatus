# Commands

All commands are registered in `src/cli/program.ts` via Commander.

## `ralph plan <project-folder>`

Opens an interactive Claude planning session. This command is a thin shim backed by the bundled `templates/plan/` pipeline template.

**Behavior:**
1. Validates the project folder exists.
2. Calls `resolveBundledTemplate("plan")` to get the bundled `templates/plan/pipeline.dot` path.
3. Delegates to `pipelineRunCommand(dotFile, { project })`.

The pipeline template handles the full planning workflow (non-interactive kickoff → session capture → interactive TUI resume).

## `ralph implement <project-folder>`

Runs the agentic implementation loop.

**Options:**
- `--max <n>` — cap the number of loop iterations (default: unlimited)

**Behavior:**
1. Resolves absolute path; exits if folder missing
2. Resolves the `implement` agent definition via the agent registry
3. Loops `agent.run()` calls with `onStdout` piped through `streamEvents()` for display
4. Git pushes after each iteration; retries once on failure

See [loop.md](loop.md) for iteration details, signal handling, and git push behavior.

## `ralph new <project-name>`

Scaffolds a new project and launches a kickoff session. This command is a thin shim backed by the bundled `templates/new/` pipeline template.

**Behavior:**
1. Conflict check: warns and exits if `./project-name/` already exists.
2. Creates directory scaffold:
   - `specs/`, `src/`
   - `meditations/illuminations/`, `meditations/archived-illuminations/`, `meditations/implemented-illuminations/`
   - Empty files: `README.md`, `AGENTS.md`, `IMPLEMENTATION_PLAN.md`
   - `.gitignore` with `IMPLEMENTATION_PLAN.md`
3. Runs `git init -b main`.
4. Calls `resolveBundledTemplate("new")` and delegates to `pipelineRunCommand(dotFile, { project, variables: { project_name } })`.

The pipeline template handles the kickoff session (non-interactive Claude run → interactive TUI resume for refinement).

## `ralph meditate <project-folder>`

Launches a meditation pipeline session. This command is a thin shim backed by the bundled `templates/meditate/` pipeline template.

**Behavior:**
1. Validates project folder exists.
2. Checks for an already-running meditate session (PID lock at `<project-folder>/.meditate.pid`); exits early if alive.
3. Ensures `meditations/{illuminations,archived-illuminations,implemented-illuminations}/` directories exist.
4. Appends meditate-specific entries (`.meditate.json`, `.meditate.pid`, MCP config glob) to `.gitignore` if missing.
5. Writes a PID lock file (`<project-folder>/.meditate.pid`).
6. Calls `resolveBundledTemplate("meditate")` and delegates to `pipelineRunCommand(dotFile, { project, variables: { steer } })`.
7. Removes the PID lock file in a `finally` block.

**`--var steer=<text>` flag:** passes a steering directive into the pipeline context as the `steer` variable (replaces the old `--steer` flag). This lets the caller influence which kind of meditation the pipeline runs without modifying the template.

**Stopping:** `Ctrl-C` on the session, or `ralph heartbeat stop meditate:<project>` for scheduled sessions.

## `ralph meditate create <project-folder>`

Creates a new meditate stimuli script via a pipeline session. This command is a thin shim backed by the bundled `templates/meditate-create/` pipeline template.

**Behavior:**
1. Validates project folder exists.
2. Calls `resolveBundledTemplate("meditate-create")` and delegates to `pipelineRunCommand(dotFile, { project })`.

No PID lock file is written; the pipeline itself handles the Claude session for generating new meditation topics.

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
- Exits with code 0 on engine failure as well — when a node's retry budget is exhausted the Ink renderer paints `fail`, a post-failure tip suggesting `ralph pipeline refine <name>` is emitted, and the process returns normally. This is a deliberate discoverability choice (see `specs/2026-04-17-refine-run-history-and-failure-tip-design.md`); scripts that need to detect run failure should parse the JSONL trace at `~/.ralph/<projectKey>/runs/<runId>/pipeline.jsonl` rather than rely on the exit code.

**Tool-node `cwd`:** every `type="tool"` node must declare a `cwd=` attribute. The command executes with that directory as cwd.

**`--project` preflight:** if the pipeline references `$project` in any node attribute, `pipeline run` requires `--project <folder>` and exits 1 otherwise with rule `project_binding_missing` (printed to stderr as `[project_binding_missing]`). `--var project=...` does not satisfy this.

**Gate-node choice in context:** every `wait-human` (hexagon) gate that resolves to a user pick writes two keys into pipeline context on success: `<gateNodeId>.choice` — authoritative and immutable for the remainder of the run, safe to reference from any downstream node, condition, or `$var` expansion — and `choice` — an alias that always holds the most-recent resolved gate's pick. Aborted or failed gates write neither key; any prior gate's `<nodeId>.choice` survives intact. Under parallel branches the bare `choice` alias is last-writer-wins and non-deterministic, so prefer `<gateNodeId>.choice` whenever two gates can race. Condition edges read these via the standard `condition="key=value"` syntax; variable expansion reads them as `$<gateNodeId>.choice` or `$choice`.

### `ralph pipeline list [folder]`

Lists available pipeline DOT files in a folder.

### `ralph pipeline validate <dotfile> [--project <folder>]`

Validates the structure of a DOT-graph pipeline without executing any handlers. Accepts either a name shorthand (resolved via `isNameShorthand` + `getPipelinesDir`, matching `run`'s resolution) or a path to a `.dot` file. The `--project <folder>` flag sets the pipelines-dir base for name-shorthand resolution.

The validator checks: missing `start` or `exit` nodes; nodes using unknown shapes; edges referencing undeclared node ids; and `reaches_exit` — every non-exit node must have at least one path to an `exit` node (dead-end detection, added 2026-04-18).

Exit 0 when the graph is valid; exit 1 on any structural error. When invoked internally by `ralph pipeline refine`, the same entry point also accepts a `previousGraph` argument and emits edge-label diff diagnostics via `diffEdgeLabels()`; this is not a user-facing flag.

### `ralph pipeline refine <name> [--project <folder>] [--no-traces]`

Opens an interactive Claude session to refine an existing pipeline. This command is a thin shim backed by the bundled `templates/pipeline-refine/` pipeline template. Requires the target `.dot` to already exist (inverse of `create`'s must-not-exist conflict check).

**Behavior:**
1. Resolves the target `.dot` path from `<pipelinesDir>/<name>.dot`; exits if not found.
2. Reads the existing DOT content and parses it (saved as `previousGraph` for post-session diff).
3. Optionally builds a `trace_digest` from up to three recent run traces via `listRecentTraces()` + `digestTraceFile()`.
4. Calls `resolveBundledTemplate("pipeline-refine")` and delegates to `pipelineRunCommand(dotFile, { project, variables: { pipeline_name, dot_path, current_dot, trace_digest } })`.
5. After the session, validates the refined graph and emits an edge-label diff against `previousGraph`.

**Flags:**
- `--project <folder>` — resolves the pipelines-dir and sets the project scope.
- `--no-traces` — suppresses the recent-traces digest block (useful when trace noise is misleading the session).

**Exit codes:**
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

Interactive session to create a new pipeline DOT file. This command is a thin shim backed by the bundled `templates/pipeline-create/` pipeline template. Delegates to `pipelineRunCommand` with the resolved template and passes `pipeline_name` as a variable.

## Git Push Behavior

After each loop iteration, `implement.ts` pushes changes:
1. `git push origin <branch>` (via `spawnSync`)
2. On failure: retry with `git push -u origin <branch>`
3. On second failure: log warning, continue looping

## Error Handling

| Condition | Command | Behavior |
|-----------|---------|----------|
| Project folder missing | `implement`, `meditate` | Exit with error |
| Project folder already exists | `new` | Warn and exit |
| `claude` not in PATH | `implement` (via loop) | Throws error |
| Claude exits non-zero | `implement` (via loop) | `log.warn()`, loop continues |
| `git push` fails twice | `implement` (via loop) | `log.warn()`, loop continues |
| Daemon not running | `heartbeat` subcommands | Auto-starts daemon |
