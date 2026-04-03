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
6. Spawn `loop.sh <project-folder>/PROMPT_build.md [N]` in its own process group (`detached: true`)
7. Forward `SIGINT`/`SIGTERM` to the process group — kills only ralph's claude, not other sessions

`--max N` caps the number of loop iterations (default: unlimited).

## Stopping the loop

Press `Ctrl+C`. Ralph forwards the signal to its own process group, cleanly terminating the claude subprocess without affecting any other running claude sessions.

If `Ctrl+C` is unresponsive, the PID is printed at startup:

```
PID: 12345  (Ctrl+C or: kill 12345)
```

From another terminal: `kill 12345` — triggers the cleanup trap in `loop.sh`, killing only that session's claude process.

## `ralph <project-folder>`

Alias for `implement`. No subcommand → runs the loop.

## Error Handling

| Condition | Behavior |
|---|---|
| Project folder not found | Print error, exit 1 |
| `claude` not in PATH | Print install hint, exit 1 |
| `loop.sh` not found | Print path, exit 1 |
