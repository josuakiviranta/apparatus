# apparatus

<!-- TODO: apparatchik flavor — explain that apparatus = the machine, apparatchik = an agent doing one job in service of the larger goal. -->

Agentic loop runner for AI-assisted project development.

## Bootstrap a project

Scaffold a fresh apparat-shaped project:

````bash
mkdir my-app && cd my-app
apparat init
````

`apparat init` is idempotent. It creates `.apparat/{pipelines,meditations/{illuminations,stimuli},sessions,runs}` plus root `docs/adr/`, scaffolds empty `CONTEXT.md`, `VISION.md`, and `README.md` at repo root, runs `git init -b main` if the directory is not yet a repo, and appends `.apparat/runs/` to `.gitignore`. It also drops a Claude Code skill shim at `.claude/skills/apparatus/SKILL.md` so that any `claude` session in the project knows how to drive apparat (run, validate, trace, author pipelines). Re-running it on an existing project fills in any missing subfolders without overwriting your files — including the skill shim, which is preserved if you've customised it.

The skill shim points Claude at a deeper authoring reference (`pipelines.md`) that lives **inside the installed `apparat-cli` npm package**, not in your repo. That keeps the reference always in sync with your pinned CLI version while keeping your project tree free of churn on apparat upgrades. See [`docs/adr/0011-skill-as-shim-plus-live-reference.md`](docs/adr/0011-skill-as-shim-plus-live-reference.md).

## Install

```bash
npm install -g apparat-cli
```

Requires: Node.js >=18, [`claude` CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed globally.

## Commands

```bash
apparat implement <project-folder>
```
Runs the agentic build loop. Claude iterates, commits, and pushes changes until the pipeline finishes. Override caps or enable scenario tests via the generic escape hatch: `apparat pipeline run implement <project-folder> --var max_iterations=N --var scenarios_dir=<path>` (the `scenarios_dir` branch requires a tmux session; see `docs/adr/0003-scenario-tests-in-implement-pipeline.md`).

Each agent turn is annotated with:
- `→ [read] path`, `→ [write] path`, `→ [edit] path` — file operations
- `→ [grep] pattern`, `→ [glob] pattern`, `→ [bash] command` — search and shell
- `▶ SUBAGENT: task` / `◀ SUBAGENT DONE` — subagent boundaries
- `◈ ctx: N tokens` — main agent context window size after each turn

```bash
apparat <project-folder>
```
Shorthand for `implement`.

```bash
apparat meditate <project-folder> [--steer <text>]
```
Runs a meditate session against the project's meditations. `--steer <text>` injects an initial steering message at session start; `--var steer=<text>` is the equivalent generic form (`--steer` wins if both are passed). Backed by the bundled folder pipeline `src/cli/pipelines/meditate/`. Equivalent to `apparat pipeline run meditate <project-folder>` — the shorthand only adds a PID lock and `.gitignore` entries.

For unattended workspace hygiene scanning, schedule the bundled janitor pipeline:

```bash
apparat heartbeat pipeline janitor --project . --every 720
```

The janitor scans source/workspace through a KISS lens — bloat, YAGNI violations, refactor opportunities — and writes one illumination per candidate. It is read-only on code; the only mutating call is `write_illumination`. See `docs/adr/0002-consume-only-illumination-lifecycle.md` for the lifecycle context.

Pass `--var key=value` (repeatable) to steer scheduled pipelines the same way `apparat pipeline run` does — every scheduled execution will receive the same caller variables:

```bash
apparat heartbeat pipeline janitor --project . --every 720 --var lens=tests
```

```bash
apparat pipeline run <pipeline> [project] [--var <key=value>...] [--resume]
```
Execute a pipeline (name or `.dot` path). Pass the project as the second positional. Use `--var` (repeatable) for caller variables:

```bash
apparat pipeline run pipelines/my-pipeline.dot ./my-app \
  --var meditations_dir=meditations
```

`--project <folder>` is accepted as a deprecated alias for the second positional; prefer the positional form. Heartbeat-scheduled invocations using the flag form keep working but emit a one-line deprecation warning.

Pass `--resume [runId]` to continue a pipeline after Ctrl-C, a node failure, or a crash. The engine checkpoints after every node advance to `<project>/.apparat/runs/<runId>/checkpoint.json` — the trace `pipeline.jsonl` lives in the same directory. Bare `--resume` auto-selects when exactly one prior run exists for the project; pass an explicit `<runId>` to disambiguate. Older runs are pruned lazily (last 50 per project, override with `APPARAT_RUNS_KEEP`). For `--resume` to be useful, tool-node scripts must be idempotent — a script that hard-requires "state before I act" will fail on retry; detect the desired outcome is already present and exit 0 as a no-op instead.

When a pipeline run fails, the stderr footer prints a copy-pasteable recipe instead of just a trace path: a bird's-eye line naming the failed node and its agent file, then `trace:` / `raw output:` (latest validation-retry attempt) / `inspect:` (the exact `pipeline trace --node-receive --full` command for that invocation), a blank line, and finally `resume:` (the exact `pipeline run … --resume <runId>` command for after you fix it). Tool-node failures omit the `agent:` clause and the `raw output:` line; pre-handler crashes omit the `inspect:` and `raw output:` lines. The recipe is mirrored inside the in-frame Ink fail block so the same hand-off is visible whether the run dies inside the TUI or after it unmounts.

```bash
apparat pipeline validate <pipeline.dot>
```
Check a pipeline for structural errors and `portability_heuristic` warnings (hardcoded paths that would break when the pipeline runs in a different environment).

```bash
apparat pipeline explain <pipeline> [nodeId]
```
Plain-text walkthrough of a pipeline's topology (per-node `consumes:` / `produces:` / `branches:` / `next:`, plus `Loops:` and `Reachability:`). With a node id, renders that agent's prompt skeleton with `<placeholder:…>` values — useful for iterating on agent `.md` files without spawning an LLM.

```bash
apparat pipeline trace <runId> [--node-receive <nodeId>] [--full]
```
Inspect the context and trace logs for a completed pipeline run. `<runId>` accepts both the slug-prefixed shape (`meditate-2f8a91c3`, the new default) and the bare 8-char shape (`2f8a91c3`, used by older runs and daemon-spawned tasks). `--node-receive` filters to a specific node execution; `--full` shows the raw JSONL trace.

### Mission control

One verb, zoom by appending the next token:

- `apparat status` — every project at a glance, with a **running now:** block at the top listing any pipeline runs in flight across all projects.
- `apparat status <projectPath>` — zoom into one project: pipelines roster + recent runs table.
- `apparat status <projectPath> <pipelineName>` — zoom into one pipeline: per-pipeline runs table.
- `apparat status <projectPath> <pipelineName> <runId>` — zoom into one run: trace renderer. Auto-tails live if the run is in-progress; static replay if finished.

Every non-leaf output ends with a `zoom in:` line containing the exact next command to copy-paste.

### Pipeline script files

Tool nodes can externalise their logic into a sibling script file next to `pipeline.dot` rather than embedding shell in the `.dot` file. Reference the script from a node with `script_file="<name>.<ext>"` (resolved relative to the pipeline folder), plus optional `script_args="..."` and `produces_from_stdout="<context-key>"`. See [`.apparat/pipelines/illumination-to-implementation/consume.mjs`](.apparat/pipelines/illumination-to-implementation/consume.mjs) for a working example, and the [design doc](docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md) for the full attribute surface and rationale.

### Parallel-implement test pipeline

`.apparat/pipelines/parallel-implement-test/` is a standalone pipeline that drives a pre-written implementation plan through DAG-scheduled parallel execution. The scheduler reads the plan, computes a topological DAG over chunks by file-overlap, and emits `<plan_path>.dag.json`. The orchestrator deep-loops one batch per iteration — one Opus subagent per chunk, each in its own `git worktree`, then topological merge into main with a single batch-level test gate. The resolver picks up any conflicted chunks (capped at 3 attempts each) and dispatches a Sonnet subagent for the resolution.

Invocation:

````bash
apparat pipeline run .apparat/pipelines/parallel-implement-test/pipeline.dot \
  --project <project-folder> \
  --var plan_path=<path-to-plan>
````

The pipeline is a v1 test of the parallel-implementation mechanism; once validated against ≥3 real plans, a follow-up spec will swap the `implement` node in `illumination-to-implementation` for this three-node chain. Requires the project to declare a `scripts.test` key in `package.json`.

### Pipeline tool nodes and `cwd=`

Every `type="tool"` node must declare `cwd=` explicitly. The value is a
literal directory (supports `$project`, `$run_id` expansion at load time).
The tool command runs with that as its working directory — avoid the old
`cd $project && ...` prefix pattern.

```dot
commit_push [type="tool",
             cwd="$project",
             tool_command="git push origin $(git branch --show-current)"]
```

If any node references `$project` in any attribute, `pipeline run` requires
`--project <folder>` — passing `--var project=...` is not a substitute.

### Deep loop nodes (agent-driven self-termination)

Agents that need to iterate until self-declared "done" — e.g. the implement
agent walking an implementation plan one chunk at a time — opt in by adding
`loop: true` and a `done: boolean` field to their frontmatter:

```yaml
---
name: my-deep-agent
description: Iterates until the work stack is empty.
model: opus
loop: true
outputs:
  done: boolean
  note: string         # optional cross-iteration handoff
---
```

The handler runs the agent in a fresh context window per iteration. After
each iteration it parses the structured output; when `done=true`, the loop
breaks and the pipeline advances. Per-iteration state lives on the
filesystem (commits, plan file). The optional `note: string` field carries
into the next iteration as `$prev_note` (replace, not accumulate). The
LAST iteration's `note` is discarded — persist anything important via files.

Cap behavior:

- `loop: true` with no cap → unlimited; agent's `done` is the only stop.
- Pipeline node attribute `max_iterations="N"` → tightens the cap for one use.
- Agent frontmatter `maxIterations: N` → default cap for the agent.
- Cascade: node > agent > (loop ? Infinity : 1).

Routing on `done`:

```dot
deep_node -> next_step  [condition="done=true"]
deep_node -> escalate   [condition="done=false"]
```

`done=false` reaches downstream only when the cap is hit without
self-termination. Pipelines can route on it for retry / escalate paths.

Authoring checklist:

- [ ] `loop: true` in frontmatter
- [ ] `outputs: { done: boolean }` (boolean shorthand or `{type: "boolean"}`)
- [ ] Prompt body instructs the agent to emit `done` after each iteration as the FINAL TEXT response (never in a thinking block)
- [ ] (Optional) `note: string` + a `$prev_note` slot in the prompt for cross-iteration self-talk
- [ ] `pipeline validate` passes

The validator rejects `loop: true` without `done: boolean` with error
`loop_missing_done_field`. A non-zero exit during any deep-loop iteration
exits the loop with `agent.success=false`.

### No-op refusal (added 2026-05-08)

The deep loop adds a `reason: {enum: [no_diff_produced, ""]}` output and a diff guard before declaring `done: true`. The HEAD SHA reference (`pre_sha`) is captured by an upstream `capture_pre_sha` tool node — `git rev-parse HEAD` runs once before the agent loop fires and the value is consumed via `inputs: capture_pre_sha.pre_sha`. Pulling the capture out of the agent prose removes a contract-drift surface (one iteration emitting bare `{"done": true}` previously broke every downstream consumer of `pre_sha`).

Inside each iteration, the agent runs `git diff --stat $capture_pre_sha_pre_sha HEAD` + `git status --porcelain` at exit. If both are empty AND the iteration claimed non-trivial work, the agent MUST emit `{ "done": false, "reason": "no_diff_produced" }` so the looping handler re-invokes it with a fresh context. Without this guard, a planning-only run can mask as a real ship — green build + green tests on an unchanged tree trivially pass any downstream `tmux_tester` node.

The diff guard is **agent-driven**, not handler-side. The looping handler at `src/attractor/handlers/looping-agent-handler.ts:151` continues to trust the `done` field as-is. Forcing `done=false` from the handler would break the deep-loop public contract for every other agent that uses the looping handler. Keeping the policy in the agent prompt also keeps it readable and tweakable per pipeline (e.g. allow no-op for doc-only plans by editing the `.md`, not TypeScript). The pre-SHA capture stays out of the prose precisely because it's a deterministic side-effect, not a policy.

## Stopping the loop

Press `Ctrl+C`. apparat cleanly terminates its own claude subprocess without affecting any other running claude sessions.

## Where to look

- **`CONTEXT.md`** — domain language and glossary
- **`docs/adr/`** — decision records (why things are the way they are)
- **`src/`** — TypeScript source (CLI, pipeline engine, daemon, MCP servers)
- **`pipelines/`** — project-local `.dot` pipelines (also `src/cli/pipelines/` for bundled ones shipped to consumers)

## Development

```bash
npm install
npm run dev        # tsx watch
npm run build      # tsup → dist/
npm link           # test apparat binary locally
```

## Decisions

See [`docs/adr/`](docs/adr/) for accepted decision records.
