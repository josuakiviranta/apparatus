# Design: Backpressure Guard for `meditate` Command

**Date:** 2026-04-12
**Status:** Approved

## Problem

`meditateCommand()` in `src/cli/commands/meditate.ts` has a PID lock to prevent concurrent sessions but no check on the number of unprocessed illumination files. When the downstream illumination-to-plan pipeline is blocked, `ralph meditate` continues producing new illuminations without bound. The producer has no awareness of consumption capacity.

The PID lock demonstrates the pattern already exists: the command reads filesystem state (`readPid()`, `isPidAlive()`) before deciding whether to proceed. The same read-before-proceed logic, applied to the illumination directory, would let the command refuse when the backlog exceeds a useful threshold.

## Solution

Add a pre-session backlog guard to `meditateCommand()` that counts files in `meditations/illuminations/` and exits early when the count meets or exceeds a configurable threshold. Default threshold is 5. Override via `RALPH_MEDITATE_MAX_OPEN` env var or `--force` flag.

## CLI Interface

```
ralph meditate <folder> [--force]
RALPH_MEDITATE_MAX_OPEN=10 ralph meditate <folder>
```

When the guard triggers:

```
6 illuminations are waiting to be processed (threshold: 5).
Run the illumination pipeline first, or archive resolved files.
Use --force to bypass this check.
```

Exit code: 0 (not an error — the command chose not to run).

## Architecture

### Data Flow

```
meditateCommand()
  ├── ensureMeditationDirs()
  ├── PID lock check (existing)
  ├── backlog guard (NEW) ──► count files in meditations/illuminations/
  │     ├── count < threshold → proceed
  │     └── count >= threshold AND !force → print warning, exit 0
  └── runMeditationSession()
```

### Components

#### `countIlluminations(projectPath: string): number`

New function in `src/cli/commands/meditate.ts` (or `src/cli/lib/illuminations.ts` if reuse emerges later). Counts files matching `meditations/illuminations/*.md` using `fs.readdirSync`. Does not parse frontmatter — a simple file count is sufficient and avoids coupling to the status state machine.

#### Guard logic in `meditateCommand()`

Inserted after `ensureMeditationDirs()` and the PID lock check, before `runMeditationSession()`:

```typescript
const threshold = parseInt(process.env.RALPH_MEDITATE_MAX_OPEN ?? "5", 10);
const force = opts.force ?? false;

if (!force) {
  const count = countIlluminations(absPath);
  if (count >= threshold) {
    // print warning with count and threshold, exit 0
    return;
  }
}
```

#### `--force` flag

Added to the `meditate` Commander registration. Bypasses the backlog guard entirely. Intended for automated invocations (schedulers, CI hooks) that opt in to unrestricted behavior.

## Files to Modify

| File | Change |
|------|--------|
| `src/cli/commands/meditate.ts` | Add `countIlluminations()`; add guard logic after PID check; accept `force` option |
| `src/cli/program.ts` | Add `--force` option to `meditate` Commander registration |

## Constraints

- **Do not parse frontmatter.** The status state machine already exists (open/dispatched/implemented/archived) but the guard should not depend on it. A file count is simpler, more robust, and sufficient for the backpressure use case. If status-aware counting is needed later, it can be added without changing the guard's interface.
- **Do not change the default threshold without user feedback.** 5 is deliberately low to force backlog processing. Users who need higher limits use the env var.
- **Exit 0, not exit 1.** The guard is advisory, not an error. Scripts chaining `ralph meditate` should not fail when the guard fires.

## Non-Goals

- No in-session awareness changes (the meditate agent already has `list_illuminations` in its tool whitelist)
- No automatic archival or cleanup of old illuminations
- No integration with the illumination state machine for filtered counting
- No changes to heartbeat meditate (it can use `--force` or the env var if needed)

## Testing

- Unit: `countIlluminations()` returns correct count for a temp directory with N `.md` files
- Unit: `meditateCommand()` with count >= threshold and no `--force` — verify early exit and warning message
- Unit: `meditateCommand()` with `--force` — verify guard is bypassed
- Unit: `RALPH_MEDITATE_MAX_OPEN=10` — verify threshold override
- Manual smoke: `ralph meditate .` with 6+ illuminations present — confirm warning printed
