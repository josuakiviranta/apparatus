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
Uses `PROMPT_plan.md` as the system prompt.

```bash
ralph implement <project-folder> [--max N] [--model <name>]
```
Runs the agentic build loop. Claude iterates, commits, and pushes changes until done (or `N` iterations).
Uses `PROMPT_build.md` as the loop prompt. `--model` overrides the LLM model for the session.

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
Scaffold a new ralph project in `./<project-name>/`. Creates `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, prompt files, `specs/`, and `src/tests/` directories, runs `git init -b main`, then launches an interactive Claude kickoff session to populate `README.md` and initial specs.

```bash
ralph meditate <project-folder> [--steer <text>]
```
Runs a meditate session against the project's meditations. `--steer` injects an initial steering message at session start.

```bash
ralph run-scenarios <project-folder> [--all]
```
Discovers `scenario-tests/*.md` files and runs them with Claude, writing reports to `scenario-runs/`. Without `--all`, presents an interactive selection menu.

```bash
ralph pipeline run <pipeline.dot> [--var <key=value>...]
```
Execute a `.dot` pipeline file. Use `--var` (repeatable) to pass caller variables:

```bash
ralph pipeline run pipelines/my-pipeline.dot \
  --var meditations_dir=meditations \
  --var specs_dir=docs/specs
```

```bash
ralph pipeline validate <pipeline.dot>
```
Check a pipeline for structural errors and `portability_heuristic` warnings (hardcoded paths that would break when the pipeline runs in a different environment).

```bash
ralph pipeline create <project-folder>
```
Open an interactive Claude session to author a new pipeline. Available local agents (`.ralph/agents/*.md`) are automatically injected into the authoring prompt.

```bash
ralph pipeline refine <name> [--project <folder>]
```
Open an interactive Claude session to iterate on an existing `<project>/pipelines/<name>.dot`. The current graph is injected into the session so the agent can propose targeted edits rather than redesigning from scratch. Use this for every change to an existing pipeline — hand-editing the `.dot` file bypasses the scheme guidance and the post-session validate step. `create` is for new workflows; `refine` is for every subsequent change.

```bash
ralph pipeline list <project-folder>
```
List all `.dot` pipeline files found in the project.

```bash
ralph pipeline trace <runId> [--node-receive <nodeId>] [--full]
```
Inspect the context and trace logs for a completed pipeline run. `--node-receive` filters to a specific node execution; `--full` shows the raw JSONL trace.

## Stopping the loop

Press `Ctrl+C`. Ralph cleanly terminates its own claude subprocess without affecting any other running claude sessions.

## First Run

On first run in a project, ralph injects default `PROMPT_plan.md` and `PROMPT_build.md` files and exits.
Review and customize them, then re-run.

## Directory Map

| Directory | Purpose |
|---|---|
| `src/` | All TypeScript source: `cli/`, `attractor/`, `daemon/`, `lib/`, `types/` |
| `specs/` | Behavioral specs per subsystem (current, authoritative) |
| `docs/` | Harness docs + `superpowers/specs/` (design history, not authoritative specs) |
| `pipelines/` | `.dot` pipeline definitions + JSON schemas; `smoke/` for smoke tests |
| `scenario-tests/` | Shell-based end-to-end scenario tests per command |
| `meditations/` | Curated lenses (meta-meditations) + `illuminations/` subfolder |
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
- [Prompt Bootstrap](specs/bootstrap.md)
- [Loop Script](specs/loop.md)
