# Agent-Based Implementation Loop

The agentic implementation loop is now driven by the `Agent` class (`src/cli/lib/agent.ts`) instead of the former `loop.ts` module. The `implement` command creates an `Agent` from the `implement` agent definition and loops `agent.run()` calls with git push between iterations.

## Why Agent replaced loop.ts

`loop.ts` was a monolithic module that duplicated spawn/stream/signal logic present in multiple commands. The `Agent` class unifies Claude session management across all commands — plan, implement, meditate, meditate-create, and pipeline nodes. This eliminates the duplication and makes it possible to define agents as markdown files with YAML frontmatter.

## Agent Class Interface

```typescript
export class Agent {
  constructor(config: AgentConfig);
  expandPrompt(variables?: Record<string, string>): string;
  buildArgs(options: RunOptions): string[];
  writeMcpConfig(cwd: string, variables?: Record<string, string>): string | null;
  cleanupMcpConfig(): void;
  run(options: RunOptions): Promise<RunResult>;
  kill(): void;
}

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  variables?: Record<string, string>;
  resume?: string;
  interactive?: boolean;
  onSessionId?: (id: string) => void;
  onStdout?: (stdout: NodeJS.ReadableStream) => Promise<void>;
}

export interface RunResult {
  exitCode: number;
  sessionId: string | null;
  stdout: Readable | null;
}
```

## Implement Loop (in implement.ts)

Each iteration:
1. Call `agent.run({ cwd, signal, onStdout })` — spawns `claude -p --dangerously-skip-permissions --output-format=stream-json --model <model>` with the prompt piped via stdin
2. `onStdout` pipes stream-json output through `streamEvents()` → `output.stream()` for human-readable display
3. After claude exits: run `git push origin <branch>`
4. If push fails, retry with `git push -u origin <branch>`; log warning on second failure and continue
5. Increment iteration counter; stop if `--max` is reached

## UI (Ink components)

| What | Tool |
|------|------|
| Startup banner | `output.header()` |
| Iteration separator | `output.step()` |
| Claude stream output | `output.stream()` via `streamEvents()` |
| Warnings | `output.warn()` |

## Signal Handling

Uses `AbortController` for external cancellation. The `implement` command registers SIGINT/SIGTERM handlers that abort and kill the agent's child process group (`process.kill(-pid, "SIGTERM")`). Checks `signal.aborted` before each iteration.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `claude` exits non-zero | `output.warn()` with exit code; loop continues |
| `git push` fails twice | `output.warn()` with error; loop continues |
| Abort signal | Loop breaks, cleanup runs |
