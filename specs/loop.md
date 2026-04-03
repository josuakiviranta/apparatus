# Loop Script

`loop.sh` is the agentic implementation engine. It runs Claude in a headless loop, committing and pushing changes after each iteration.

## Signature

```bash
./loop.sh <prompt-file> [max_iterations]
```

- `<prompt-file>`: absolute path to the prompt markdown file
- `max_iterations`: optional cap (default: 0 = unlimited)

## Behavior

Each iteration:
1. Run `claude -p --dangerously-skip-permissions --output-format=stream-json --model opus < <prompt-file>`, piping output to `jq` via process substitution
2. Track claude's PID — on `SIGINT`/`SIGTERM`, only that PID is killed (not all claude processes)
3. `git push` after iteration completes
4. If push fails, retry with `-u origin <branch>`
5. Check iteration count; stop if limit reached

## Shutdown

`Ctrl+C` → `cleanup()` trap fires → kills the tracked `CLAUDE_PID` only → exits cleanly.

If `Ctrl+C` is unresponsive, the script prints its own PID (`$$`) in the banner at startup. From another terminal: `kill <PID>` — same trap fires, same clean shutdown.

## Distribution

`loop.sh` is bundled into `dist/` at build time by `tsup.config.ts`. At runtime, `getLoopShPath()` in `src/cli/lib/assets.ts` resolves its location relative to `dist/index.js`.

The script is usable standalone as well — `ralph` simply calls it with an explicit prompt file path so it works from any directory.
