# Ralph Heartbeat Daemon Implementation Plan

> **Status: COMPLETE** — All 9 chunks implemented, 142 tests passing, tagged 0.0.11

**Goal:** Replace cron-based meditate scheduling with a persistent central daemon that ralph CLI owns and controls, with full observability via `ralph heartbeat` commands.

**Architecture:** A long-running Node.js daemon at `~/.ralph/daemon.sock` manages all scheduled tasks. CLI communicates via JSON-lines over a Unix socket. Flat files in `~/.ralph/` store task registry (`tasks.json`) and per-run logs (`logs/<task-id>/<run-id>.log`). Tasks are dispatched by spawning `ralph <command> <args>` as a subprocess.

**Tech Stack:** TypeScript, Node.js `net` (Unix sockets), `ink` + `react` (TUI), vitest

---

## Implementation Summary

| Chunk | Status | Commit | Tests |
|-------|--------|--------|-------|
| 1. Build Config | ✅ Done | `859bd43` | Build passes |
| 2. State Layer | ✅ Done | `7878d0e` | 14 tests |
| 3. Scheduler | ✅ Done | `807de50` | 8 tests |
| 4. Runner | ✅ Done | `69ca366` | 5 tests |
| 5. Socket Server | ✅ Done | `ae36aaa` | 4 tests |
| 6. Daemon Entry + Client | ✅ Done | `c46b2b2` | Integration glue |
| 7. Heartbeat CLI Commands | ✅ Done | `c2cde96` | 4 tests |
| 8. Watch TUI | ✅ Done | `33d98e0` | Manual only (TTY) |
| 9. Meditate Cleanup | ✅ Done | `04eb795` | 28 remaining |

## Learnings

- `os.homedir()` does not reflect runtime `process.env.HOME` changes in tests. Use `process.env.HOME || homedir()` for testability.
- Parallel subagent execution on shared filesystem can cause transient test failures. Run final verification sequentially.
- The runner's `RALPH_TEST_CMD` needs `shell: true` for commands with quoted arguments like `process.exit(1)`.
- Keeping the shebang banner on daemon entry is harmless — Node ignores it when spawned via `node path/to/file.js`.

## Future Work

- [ ] `stream_logs` handler is stubbed (returns no-op). Implement for `ralph heartbeat logs --follow`.
- [ ] Ink TUI (`HeartbeatWatch.tsx`) needs manual TTY testing and polish.
- [ ] End-to-end integration test: start daemon, register task, verify execution, stop.
- [ ] Daemon auto-restart on crash (systemd/launchd integration).
