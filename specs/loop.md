# Loop Module

`src/cli/lib/loop.ts` is the agentic implementation engine. It runs Claude in a headless loop, piping output through the stream formatter and pushing changes after each iteration.

## Interface

```typescript
export interface LoopOptions {
  promptFile: string;  // absolute path to PROMPT_build.md
  cwd: string;         // project folder (claude cwd + git ops)
  max?: number;        // max iterations; undefined = unlimited
  model?: string;      // passed to --model flag; defaults to "opus"
  signal?: AbortSignal; // optional abort signal for external cancellation
  onSessionId?: (id: string) => void; // callback when session ID is captured
}

export interface LoopResult {
  exitReason: "completed" | "maxReached" | "aborted" | "error";
}

export async function runLoop(options: LoopOptions): Promise<LoopResult>
```

Called by `implement.ts` and `ralph-implement` pipeline handler. Checks `claude` availability before starting.

## Each Iteration

1. Spawn `claude -p --dangerously-skip-permissions --output-format=stream-json --model <model>` with `cwd` set to the project folder and the prompt file piped to stdin
2. Read stdout line-by-line through `processLine()` from `stream-formatter.ts`; write formatted output to `process.stdout`
3. After claude exits: run `git push origin <branch>` in a clack spinner
4. If push fails, retry with `git push -u origin <branch>`; log warning on second failure and continue
5. Increment iteration counter; stop if `max` is reached

## UI (clack/prompts)

| What | Tool |
|------|------|
| Startup banner | `intro()` |
| Iteration separator | `note()` |
| PID display | `log.step()` |
| Git push status | `spinner()` |
| Loop end | `outro()` |
| Claude stream output | Raw `process.stdout.write()` via stream-formatter |

## Signal Handling

Uses `AbortSignal` for external cancellation. Registers an abort listener that kills the current child process group (`process.kill(-currentPid, "SIGTERM")`). Checks `signal?.aborted` before each iteration. Listeners are cleaned up in a `finally` block via `signal?.removeEventListener`.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `promptFile` not found | Throws `Error` before loop starts |
| `claude` not in PATH | Throws `Error` before loop starts |
| `git push` fails | `log.warn()` with error; loop continues |
| Claude exits non-zero | `log.warn()` with exit code; loop continues |
