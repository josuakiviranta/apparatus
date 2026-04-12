# Design: `--steer` Flag for `meditate` Command

**Date:** 2026-04-14
**Status:** Approved

## Problem

`ralph meditate <folder>` runs a reflection session with no way to focus it. Every run uses the same open-ended agent prompt. Users and scheduled heartbeat jobs cannot direct the session toward a specific area of concern without editing agent config files.

## Solution

Add an optional `--steer <text>` flag to `ralph meditate` and `ralph heartbeat meditate`. When provided, the text is injected as the first user message Claude sees at session start (via `--message` on the claude CLI spawn). When omitted, behavior is identical to today.

## CLI Interface

```
ralph meditate <folder> [--steer <text>]
ralph heartbeat meditate <folder> --every <n> [--steer <text>]
```

Examples:

```sh
ralph meditate . --steer "focus on the auth module"
ralph heartbeat meditate my-app --every 30 --steer "look for regressions in pipeline routing"
```

## Architecture

### meditate.ts

- Add `.option('--steer <text>', 'initial steering message for the session')` to the Commander registration
- Thread `steer?: string` through to `runMeditationSession(absPath, steer?)`
- In the claude spawn, when `steer` is present, append `--message <steer>` to the claude CLI args

### heartbeat.ts (meditate subcommand)

- Add the same `.option('--steer <text>', ...)` to the heartbeat meditate subcommand
- When registering the daemon task, append `["--steer", steerText]` to the `args` array if `--steer` was supplied

```typescript
// heartbeat.ts — register_task args
args: steer ? [absPath, "--steer", steer] : [absPath]
```

The daemon runner already replays `task.args` verbatim, so the scheduled spawn becomes:

```
node dist/cli/index.js meditate /abs/path --steer "focus on auth"
```

No changes required to the daemon or runner.

## Files to Modify

| File | Change |
|------|--------|
| `src/cli/commands/meditate.ts` | Add `--steer` option; pass `--message` to claude spawn |
| `src/cli/commands/heartbeat.ts` | Add `--steer` option to meditate subcommand; include in `args` |

## Non-Goals

- No preset/named steering profiles
- No steering via file path
- No changes to `meditate create` or the pipeline handler
- No changes to the daemon, runner, or agent config files

## Testing

- Unit: `meditateCommand` with and without `--steer` — verify claude spawn args
- Unit: heartbeat meditate with `--steer` — verify `args` array in `register_task` payload
- Manual smoke: `ralph meditate . --steer "focus on X"` produces a session steered toward X
