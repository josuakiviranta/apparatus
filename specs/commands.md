# Commands

## `ralph plan <project-folder>`

Opens a two-phase brainstorm + interactive planning session.

1. Resolve `<project-folder>` to absolute path (exit 1 if missing)
2. Check `claude` is in PATH (exit 1 with install hint if not)
3. **Phase 1 — Non-interactive brainstorm kickoff:** Spawns `claude -p <trigger> --output-format stream-json --dangerously-skip-permissions` with `cwd: projectFolder`. The trigger instructs Claude to study specs and source, then invoke the brainstorming skill. Streams assistant text and tool-use indicators to stdout. Captures the `session_id` from the stream-json output.
4. **Phase 2 — Interactive resume:** Spawns `claude --dangerously-skip-permissions --resume <session_id>` with `stdio: inherit`, letting the user refine the brainstorm interactively.
5. Exit when user closes the session

> **Note:** This command does not run prompt bootstrap or read `PROMPT_plan.md`. The brainstorming skill provides the planning structure instead of a static prompt file.

## `ralph implement <project-folder> [--max N]`

Runs the agentic build loop via `loop.ts` (compiled into `dist/`).

1. Run [prompt bootstrap](bootstrap.md)
2. Resolve & validate project folder
3. Check `claude` is in PATH
4. Run the loop engine (`src/cli/lib/loop.ts`) with `<project-folder>/PROMPT_build.md` and optional iteration cap
5. Forward `SIGINT`/`SIGTERM` to the claude subprocess — kills only ralph's claude, not other sessions

`--max N` caps the number of loop iterations (default: unlimited).

## Stopping the loop

Press `Ctrl+C`. Ralph forwards the signal to its own process group, cleanly terminating the claude subprocess without affecting any other running claude sessions.

The PID is printed at startup:

```
PID: 12345  (Ctrl+C or: kill 12345)
```

From another terminal: `kill 12345` — triggers cleanup, killing only that session's claude process.

## Git push behavior

After each loop iteration, ralph runs `git push origin <branch>`. If the push fails (e.g., no upstream configured), it retries with `git push -u origin <branch>` to set the upstream tracking branch. If both attempts fail, a warning is logged and the loop continues.

## `ralph <project-folder>`

Alias for `implement`. No subcommand → runs the loop.

## Error Handling

| Condition | Behavior |
|---|---|
| Project folder not found | Print error, exit 1 |
| `claude` not in PATH | Print install hint, exit 1 |
| Loop engine fails to start | Print error, exit 1 |
