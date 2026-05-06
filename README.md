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
apparat implement <project-folder> [--max N] [--scenarios <path>]
```
Runs the agentic build loop. Claude iterates, commits, and pushes changes until done (or `N` iterations).

`--scenarios <path>` enables an opt-in branch that authors operator-surface
scenario tests in `<project>/<path>` after the implementer finishes, then
drives them through a tmux harness — fixing code red-green until they pass
or the agent judges itself stuck. The flag requires running inside a tmux
session (preflight check). Scenario test format and discipline are
documented in `CONTEXT.md` and `docs/adr/0003-scenario-tests-in-implement-pipeline.md`.

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
apparat meditate <project-folder> [--var steer=<text>]
```
Runs a meditate session against the project's meditations. `--var steer=...` injects an initial steering message at session start. Backed by the bundled folder pipeline `src/cli/pipelines/meditate/`. Equivalent to `apparat pipeline run meditate --project <project-folder>` — the shorthand only adds a PID lock and `.gitignore` entries.

For unattended workspace hygiene scanning, schedule the bundled janitor pipeline:

```bash
apparat heartbeat pipeline janitor --project . --every 720
```

The janitor scans source/workspace through a KISS lens — bloat, YAGNI violations, refactor opportunities — and writes one illumination per candidate. It is read-only on code; the only mutating call is `write_illumination`. See `docs/adr/0002-consume-only-illumination-lifecycle.md` for the lifecycle context.

```bash
apparat pipeline run <pipeline.dot> [--var <key=value>...] [--resume]
```
Execute a `.dot` pipeline file. Use `--var` (repeatable) to pass caller variables:

```bash
apparat pipeline run pipelines/my-pipeline.dot \
  --var meditations_dir=meditations
```

Pass `--resume [runId]` to continue a pipeline after Ctrl-C, a node failure, or a crash. The engine checkpoints after every node advance to `<project>/.apparat/runs/<runId>/checkpoint.json` — the trace `pipeline.jsonl` lives in the same directory. Bare `--resume` auto-selects when exactly one prior run exists for the project; pass an explicit `<runId>` to disambiguate. Older runs are pruned lazily (last 50 per project, override with `APPARAT_RUNS_KEEP`). For `--resume` to be useful, tool-node scripts must be idempotent — a script that hard-requires "state before I act" will fail on retry; detect the desired outcome is already present and exit 0 as a no-op instead.

```bash
apparat pipeline validate <pipeline.dot>
```
Check a pipeline for structural errors and `portability_heuristic` warnings (hardcoded paths that would break when the pipeline runs in a different environment).

```bash
apparat pipeline list <project-folder>
```
List all `.dot` pipeline files found in the project.

```bash
apparat pipeline trace <runId> [--node-receive <nodeId>] [--full]
```
Inspect the context and trace logs for a completed pipeline run. `--node-receive` filters to a specific node execution; `--full` shows the raw JSONL trace.

### Pipeline script files

Tool nodes can externalise their logic into a sibling script file next to `pipeline.dot` rather than embedding shell in the `.dot` file. Reference the script from a node with `script_file="<name>.<ext>"` (resolved relative to the pipeline folder), plus optional `script_args="..."` and `produces_from_stdout="<context-key>"`. See [`.apparat/pipelines/illumination-to-implementation/consume.mjs`](.apparat/pipelines/illumination-to-implementation/consume.mjs) for a working example, and the [design doc](docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md) for the full attribute surface and rationale.

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
