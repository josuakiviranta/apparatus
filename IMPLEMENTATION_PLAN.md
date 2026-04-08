# ralph-cli Implementation Plan

> **Current status:** All planned features implemented. Specs synchronized. Tag: 0.0.34.

## Completed Work

| Tag | Feature | Date |
|-----|---------|------|
| 0.0.33 | Heartbeat: Schedule any ralph command (implement, run-scenarios, pipeline) | 2026-04-10 |
| 0.0.34 | Specs synchronization: commands.md, heartbeat.md, mcp-illumination.md, loop.md | 2026-04-11 |

## Spec Sync Summary (0.0.34)

Specs were stale in several areas where code had evolved past the original designs:

- **commands.md**: Added heartbeat implement/run-scenarios/pipeline/pause/resume/kill subcommands. Removed nonexistent `ralph meditate kill` (users use Ctrl-C or heartbeat stop). Updated error handling from `cancel()+exit` to `throws Error`.
- **mcp-illumination.md**: Added `glob_files` tool (7th tool, was undocumented). Updated tool count.
- **loop.md**: Updated interface to show `LoopResult` return type, `AbortSignal` support, `onSessionId` callback. Updated signal handling and error handling sections.
- **heartbeat.md**: Added pause/resume/kill subcommands. Removed stale "known issue" about watch being broken (it's functional).

## Known Issues

None.

## Future Work Candidates

- Automated integration tests for `heartbeat watch` TUI
- Spec coverage for attractor pipeline engine in `specs/` (currently only in `docs/superpowers/specs/`)
