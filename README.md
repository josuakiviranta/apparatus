# ralph-cli

Agentic loop runner for AI-assisted project development.

## Install

```bash
npm install -g ralph-cli
```

Requires: Node.js >=18, [`claude` CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed globally.

## Commands

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
ralph meditate <project-folder> [--var steer=<text>]
```
Runs a meditate session against the project's meditations. `--var steer=...` injects an initial steering message at session start. Backed by the bundled folder pipeline `src/cli/pipelines/meditate/`.

For unattended workspace hygiene scanning, schedule the bundled janitor pipeline:

```bash
ralph heartbeat pipeline pipelines/janitor/pipeline.dot --project . --every 720
```

The janitor scans source/workspace through a KISS lens — bloat, YAGNI violations, refactor opportunities — and writes one illumination per candidate. It is read-only on code; the only mutating call is `write_illumination`. See `docs/adr/0002-consume-only-illumination-lifecycle.md` for the lifecycle context.

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

Press `Ctrl+C`. Ralph cleanly terminates its own claude subprocess without affecting any other running claude sessions.

## Directory Map

| Directory | Purpose |
|---|---|
| `src/` | All TypeScript source: `cli/`, `attractor/`, `daemon/`, `lib/`, `types/` |
| `docs/specs/` | Authoritative behavioral specs (what the system does) |
| `docs/` | Harness docs + `superpowers/specs/` (design proposals & history — how decisions were reached) |
| `pipelines/` | Project-local `.dot` pipelines for ralph-cli itself (illumination-to-implementation, janitor) + `smoke/` test fixtures. Bundled pipelines (meditate, implement) ship from `src/cli/pipelines/`. |
| `src/cli/pipelines/` | Bundled pipelines shipped to npm consumers (`meditate`, `implement`). Folder-form: `<name>/pipeline.dot` + agent `.md` files. Copied to `dist/pipelines/` at build. |
| `meditations/` | Curated lenses in `stimuli/` + three illumination status dirs: `illuminations/` (open + dispatched), `archived-illuminations/`, `implemented-illuminations/` |
| `memory/` | Session memory written by Claude agents across conversations |

> **docs/specs/ vs docs/superpowers/specs/:** `docs/specs/` holds authoritative behavioral specifications (what the system does). `docs/superpowers/specs/` holds design proposals and history (how decisions were reached).

## Development

```bash
npm install
npm run dev        # tsx watch
npm run build      # tsup → dist/
npm link           # test ralph binary locally
```

## Specs

- [Architecture](docs/specs/architecture.md)
- [Commands](docs/specs/commands.md)
- [Loop Script](docs/specs/loop.md)
