# loop.ts Module Design

**Date:** 2026-04-07
**Status:** Approved

## Overview

Replace `loop.sh` as the runtime engine for `ralph implement` with a TypeScript module `src/cli/lib/loop.ts`. The shell script stays in the repo but is no longer invoked by the CLI. The module is imported by `implement.ts` and called directly.

## Interface

```typescript
export interface LoopOptions {
  promptFile: string;  // absolute path to PROMPT_build.md
  cwd: string;         // project folder (claude cwd + git ops)
  max?: number;        // max iterations; undefined = unlimited
  model?: string;      // passed directly to --model flag; defaults to "opus"
}

export async function runLoop(options: LoopOptions): Promise<void>
```

`implement.ts` removes: `getLoopShPath()`, `chmodSync`, `RALPH_STREAM_FORMATTER*` env setup, and the `loop.sh` spawn. It calls `runLoop({ promptFile, cwd: absPath, max: options.max })` instead.

The `claude` availability check moves from `implement.ts` into `runLoop` (it is now loop's responsibility).

## Loop Internals

**Startup:** Run `git branch --show-current` in `cwd` to capture the branch name before the loop begins.

On each iteration:

1. Spawn `claude -p --dangerously-skip-permissions --output-format=stream-json --model <model>` with:
   - `cwd` set to the project folder
   - `stdio: ['pipe', 'pipe', 'inherit']` — stdin piped (to send prompt content), stdout piped (for line-by-line reading), stderr inherited
   - `detached: true` — so the child gets its own process group, enabling group kill on signal
   - Pipe a `fs.createReadStream(promptFile)` into the child's stdin (equivalent to `< promptFile` in shell)
2. Read child stdout line-by-line; feed each line through `processLine()` imported directly from `stream-formatter.ts`. Write formatter output to `process.stdout` (raw — no clack wrapping).
3. After claude exits: run `git push origin <branch>` (branch captured at startup) wrapped in a clack `spinner()`.
4. Print an iteration separator with clack.
5. Increment counter; check max iterations.

Note: `--verbose` is intentionally omitted. The stream-formatter already surfaces all relevant events; verbose mode adds internal Claude CLI noise that is not useful to the user.

## Output Responsibilities

| What | Tool |
|------|------|
| Startup banner (mode, prompt, branch) | `@clack/prompts` `intro()` |
| Iteration separator (`LOOP N`) | `@clack/prompts` `note()` or `log.step()` |
| Git push status | `@clack/prompts` `spinner()` |
| Loop end (max reached / interrupted) | `@clack/prompts` `outro()` |
| Claude stream output (tool calls, text, subagents) | Raw `process.stdout.write()` via `stream-formatter` |

## Signal Handling

`SIGINT` / `SIGTERM` on `process` kills the claude child by process group: `process.kill(-child.pid!, "SIGTERM")`. This requires `detached: true` on the spawn (see Loop Internals). After killing, call `outro()` before exit.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `promptFile` not found | `cancel()` + exit before loop starts |
| `claude` not in PATH | `cancel()` + exit before loop starts |
| `git push` fails | `log.warn()` with error message; loop continues |
| Claude exits non-zero | `log.warn()` with exit code; loop continues |

## Files

| File | Change |
|------|--------|
| `src/cli/lib/loop.ts` | New module |
| `src/cli/tests/loop.test.ts` | New unit tests (mock `spawn` + git) |
| `src/cli/commands/implement.ts` | Simplified — calls `runLoop()` |
| `loop.sh` | Kept, no longer called by CLI |
| `src/cli/lib/stream-formatter.ts` | No changes |

## Dependencies

Add `@clack/prompts` to `package.json` `dependencies` (not devDependencies — it is required at runtime).
