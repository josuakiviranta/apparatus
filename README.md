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
ralph implement <project-folder> [--max N]
```
Runs the agentic build loop. Claude iterates, commits, and pushes changes until done (or `N` iterations).
Uses `PROMPT_build.md` as the loop prompt.

Each agent turn is annotated with:
- `→ [read] path`, `→ [write] path`, `→ [edit] path` — file operations
- `→ [grep] pattern`, `→ [glob] pattern`, `→ [bash] command` — search and shell
- `▶ SUBAGENT: task` / `◀ SUBAGENT DONE` — subagent boundaries
- `◈ ctx: N tokens` — main agent context window size after each turn

```bash
ralph <project-folder>
```
Shorthand for `implement`.

## Stopping the loop

Press `Ctrl+C`. Ralph cleanly terminates its own claude subprocess without affecting any other running claude sessions.

## First Run

On first run in a project, ralph injects default `PROMPT_plan.md` and `PROMPT_build.md` files and exits.
Review and customize them, then re-run.

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
