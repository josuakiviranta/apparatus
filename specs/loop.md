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
1. Pipe `<prompt-file>` to `claude -p --dangerously-skip-permissions --output-format=stream-json --model opus`
2. Parse structured JSON output with `jq`
3. `git add -A && git commit && git push`
4. If push fails, retry with `-u origin <branch>`
5. Check iteration count; stop if limit reached

## Distribution

`loop.sh` is bundled into `dist/` at build time by `tsup.config.ts`. At runtime, `getLoopShPath()` in `src/cli/lib/assets.ts` resolves its location relative to `dist/index.js`.

The script is usable standalone as well — `ralph` simply calls it with an explicit prompt file path so it works from any directory.
