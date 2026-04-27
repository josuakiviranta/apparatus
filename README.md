# ralph-cli

Agentic loop runner for AI-assisted project development.

## Install

```bash
npm install -g ralph-cli
```

Requires: Node.js >=18, [`claude` CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed globally.

## Commands

```bash
ralph plan <project-folder>
```
Opens an interactive Claude session in the project folder for planning/spec writing.
Backed by the bundled pipeline template `src/cli/templates/plan/`.

```bash
ralph implement <project-folder> [--max N] [--model <name>]
```
Runs the agentic build loop. Claude iterates, commits, and pushes changes until done (or `N` iterations).
`--model` overrides the LLM model for the session.

Each agent turn is annotated with:
- `→ [read] path`, `→ [write] path`, `→ [edit] path` — file operations
- `→ [grep] pattern`, `→ [glob] pattern`, `→ [bash] command` — search and shell
- `▶ SUBAGENT: task` / `◀ SUBAGENT DONE` — subagent boundaries
- `◈ ctx: N tokens` — main agent context window size after each turn

```bash
ralph <project-folder>
```
Shorthand for `implement`.

```bash
ralph new <project-name>
```
Scaffold a new ralph project in `./<project-name>/`. Creates `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `specs/`, and `src/` directories, runs `git init -b main`, then launches an interactive Claude kickoff session (backed by the bundled `new` pipeline template `src/cli/templates/new/`) to populate `README.md` and initial specs.

```bash
ralph meditate <project-folder> [--var steer=<text>]
```
Runs a meditate session against the project's meditations. `--var steer=...` injects an initial steering message at session start. Backed by the bundled pipeline template `src/cli/templates/meditate/`.

For unattended lifecycle reconciliation and doc-drift surfacing, schedule the bundled janitor pipeline:

```bash
ralph heartbeat pipeline pipelines/janitor.dot --project . --every 720
```

The janitor is read-only on code; it only writes new illuminations and flips lifecycle frontmatter. See `docs/superpowers/specs/2026-04-25-janitor-agent-design.md` for the full design.

```bash
ralph pipeline run <pipeline.dot> [--var <key=value>...] [--resume]
```
Execute a `.dot` pipeline file. Use `--var` (repeatable) to pass caller variables:

```bash
ralph pipeline run pipelines/my-pipeline.dot \
  --var meditations_dir=meditations \
  --var specs_dir=docs/specs
```

Pass `--resume [runId]` to continue a pipeline after Ctrl-C, a node failure, or a crash. The engine checkpoints after every node advance to `~/.ralph/<projectKey>/runs/<runId>/checkpoint.json` — the trace `pipeline.jsonl` lives in the same directory. Bare `--resume` auto-selects when exactly one prior run exists for the project; pass an explicit `<runId>` to disambiguate. Older runs are pruned lazily (last 50 per project, override with `RALPH_RUNS_KEEP`). For `--resume` to be useful, tool-node scripts must be idempotent — a script that hard-requires "state before I act" will fail on retry; detect the desired outcome is already present and exit 0 as a no-op instead.

```bash
ralph pipeline validate <pipeline.dot>
```
Check a pipeline for structural errors and `portability_heuristic` warnings (hardcoded paths that would break when the pipeline runs in a different environment).

```bash
ralph pipeline create <project-folder>
```
Open an interactive Claude session to author a new pipeline. Backed by the bundled pipeline template `src/cli/templates/pipeline-create/`. The scaffolder agent inspects the project's existing `pipelines/<name>/` folders for reusable agent files.

```bash
ralph meditate-create <project-folder>
```
Open an interactive Claude session to author a new meditation stimulus. Backed by the bundled pipeline template `src/cli/templates/meditate-create/`.

```bash
ralph pipeline refine <name> [--project <folder>] [--no-traces]
```
Open an interactive Claude session to iterate on an existing `<project>/pipelines/<name>.dot`. The current graph is injected into the session so the agent can propose targeted edits rather than redesigning from scratch. Backed by the bundled pipeline template `src/cli/templates/pipeline-refine/`. Use this for every change to an existing pipeline — hand-editing the `.dot` file bypasses the scheme guidance and the post-session validate step. `create` is for new workflows; `refine` is for every subsequent change.

By default, digests of up to 3 recent run traces for this pipeline are injected into the session so the agent can see how the graph has been executing. Pass `--no-traces` to suppress this when experimenting with a half-written pipeline.

```bash
ralph pipeline list <project-folder>
```
List all `.dot` pipeline files found in the project.

```bash
ralph pipeline trace <runId> [--node-receive <nodeId>] [--full]
```
Inspect the context and trace logs for a completed pipeline run. `--node-receive` filters to a specific node execution; `--full` shows the raw JSONL trace.

### Pipeline script files

Tool nodes can externalise their logic into `pipelines/scripts/<name>.<ext>` rather than embedding shell in the `.dot` file. Reference the script from a node with `script_file="pipelines/scripts/<name>.mjs"` (plus optional `script_args="..."` and `produces_from_stdout="<context-key>"`). See [`pipelines/scripts/mark-dispatched.mjs`](pipelines/scripts/mark-dispatched.mjs) for a working example, and the [design doc](docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md) for the full attribute surface and rationale.

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

## Stopping the loop

Press `Ctrl+C`. Ralph cleanly terminates its own claude subprocess without affecting any other running claude sessions.

## Directory Map

| Directory | Purpose |
|---|---|
| `src/` | All TypeScript source: `cli/`, `attractor/`, `daemon/`, `lib/`, `types/` |
| `specs/` | Behavioral specs per subsystem (current, authoritative) |
| `docs/` | Harness docs + `superpowers/specs/` (design history, not authoritative specs) |
| `pipelines/` | `.dot` pipeline definitions + JSON schemas; `smoke/` for smoke tests |
| `meditations/` | Curated lenses in `stimuli/` + three illumination status dirs: `illuminations/` (open + dispatched), `archived-illuminations/`, `implemented-illuminations/` |
| `memory/` | Session memory written by Claude agents across conversations |

> **specs/ vs docs/superpowers/specs/:** `specs/` holds current behavioral specifications that are authoritative. `docs/superpowers/specs/` holds historical design documents that motivated those specs.

## Development

```bash
npm install
npm run dev        # tsx watch
npm run build      # tsup → dist/
npm link           # test ralph binary locally
```

## Specs

- [Architecture](specs/architecture.md)
- [Commands](specs/commands.md)
- [Loop Script](specs/loop.md)
