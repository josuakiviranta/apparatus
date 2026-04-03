# Commands

## `ralph plan <project-folder>`

Opens an interactive Claude Code TUI for planning/spec writing.

1. Run [prompt bootstrap](bootstrap.md)
2. Resolve `<project-folder>` to absolute path (exit 1 if missing)
3. Check `claude` is in PATH (exit 1 with install hint if not)
4. Read `<project-folder>/PROMPT_plan.md`
5. Spawn: `claude --append-system-prompt <content>` with `cwd: projectFolder`, `stdio: inherit`
6. Exit when user closes the session

## `ralph implement <project-folder> [--max N]`

Runs the agentic build loop via `loop.sh`.

1. Run [prompt bootstrap](bootstrap.md)
2. Resolve & validate project folder
3. Check `claude` is in PATH
4. Resolve `loop.sh` path from bundled assets
5. `chmod +x loop.sh` if needed
6. Execute: `loop.sh <project-folder>/PROMPT_build.md [N]` with `cwd: projectFolder`, `stdio: inherit`

`--max N` caps the number of loop iterations (default: unlimited).

## `ralph <project-folder>`

Alias for `implement`. No subcommand → runs the loop.

## Error Handling

| Condition | Behavior |
|---|---|
| Project folder not found | Print error, exit 1 |
| `claude` not in PATH | Print install hint, exit 1 |
| `loop.sh` not found | Print path, exit 1 |
