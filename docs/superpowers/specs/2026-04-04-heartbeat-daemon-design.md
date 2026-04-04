# Ralph Heartbeat Daemon — Design Spec

**Date:** 2026-04-04
**Status:** Approved

## Overview

Replace the cron-based meditation scheduler with a persistent central daemon that ralph CLI owns and controls. The daemon manages scheduled tasks (initially `meditate`, extensible to other commands), provides full observability via pull and push interfaces, and surfaces all errors as clear human-readable messages.

The heartbeat subsystem is designed as a generic scheduling substrate — `meditate` is the first command type, but new command types can be registered without rebuilding the scheduling infrastructure.

---

## Architecture

Three layers:

**1. Ralph Daemon** (`~/.ralph/`)
A long-running Node.js process detached from any terminal. Manages task scheduling, spawns child processes for each run, captures all output, and serves a Unix socket at `~/.ralph/daemon.sock`. Auto-starts when any `ralph heartbeat` command is issued and the daemon is not running. PID tracked at `~/.ralph/daemon.pid`.

**2. Flat File State** (`~/.ralph/`)
- `tasks.json` — task registry (all registered tasks, intervals, status)
- `logs/<task-id>/<run-id>.log` — one log file per run, append-only

No database dependency. Maps directly to the three-table schema below; SQLite can be swapped in later by replacing `src/daemon/state.ts` only.

**3. CLI → Daemon IPC** (JSON-lines over Unix socket)
All `ralph heartbeat` subcommands connect to `~/.ralph/daemon.sock`, send a JSON request line, and receive response line(s). Streaming commands (`logs --follow`, `watch`) keep the connection open. A `src/lib/daemon-client.ts` module handles all socket communication including auto-start.

**New source files:**
```
src/daemon/
  index.ts        # daemon entry point, daemonizes, starts scheduler + socket server
  scheduler.ts    # interval management, task dispatch, skip-if-running logic
  state.ts        # flat file CRUD: tasks.json + log files
  socket.ts       # Unix socket server + JSON-lines protocol
  runner.ts       # child process spawning, stdout/stderr capture, system log lines
src/cli/commands/
  heartbeat.ts    # CLI subcommands wired to daemon-client
src/lib/
  daemon-client.ts  # connect to daemon.sock, auto-start daemon if absent
```

### Runner Dispatch

`runner.ts` dispatches tasks as **subprocesses**, not in-process function calls. When the scheduler fires a task, runner spawns:

```
ralph meditate <abs-path>
```

This keeps the daemon generic — it has no knowledge of meditate internals. Adding a new command type means registering a new `command` string and mapping it to a `ralph <command> <args>` subprocess call in `runner.ts`. stdout and stderr are piped and written line-by-line to the task's log file with timestamps and stream labels.

The spawned process path is resolved via `process.execPath` (the node binary) + the ralph CLI entry (`dist/index.js`), so it works regardless of how ralph is installed globally.

---

## Daemon Lifecycle

**Startup (auto-start from CLI):**
1. CLI checks if `~/.ralph/daemon.sock` exists and is connectable
2. If not: CLI spawns `node dist/daemon/index.js` with `detached: true, stdio: 'ignore'`, then calls `unref()` so the CLI process can exit independently
3. CLI polls for `~/.ralph/daemon.sock` every 100ms, up to 3s
4. If socket appears: proceed with the original request
5. If 3s elapsed: exit with `"Error: ralph daemon failed to start — check permissions on ~/.ralph/"`

**Daemon startup sequence:**
1. Check `~/.ralph/daemon.pid` — if PID exists and is alive, exit (another instance is running)
2. Delete stale `~/.ralph/daemon.sock` if present (leftover from a crash)
3. Write own PID to `~/.ralph/daemon.pid`
4. Create `~/.ralph/` and `~/.ralph/logs/` if missing
5. Load `tasks.json`, resume scheduling for all `active` tasks
6. Start Unix socket server at `~/.ralph/daemon.sock`
7. Register SIGTERM/SIGINT handlers: flush state, remove PID file, close socket

**Crash recovery:**
If the daemon crashes between sessions, the next `ralph heartbeat` CLI command triggers auto-start. The new daemon instance re-reads `tasks.json` and resumes all active schedules. In-flight session processes (if any) continue independently under their own PID locks.

---

## State Schema

Flat file equivalents of three logical tables:

**`~/.ralph/tasks.json`**
```json
[
  {
    "id": "meditate:job-post-worker",
    "command": "meditate",
    "args": ["/abs/path/to/project"],
    "interval": 5,
    "status": "active",
    "createdAt": 1743800000000,
    "lastRunAt": 1743800300000,
    "nextRunAt": 1743800600000
  }
]
```

**`~/.ralph/logs/<task-id>/<run-id>.log`**
Append-only lines, one JSON object per line:
```json
{"ts": 1743800000000, "stream": "system", "content": "Session started"}
{"ts": 1743800001000, "stream": "stdout", "content": "Illumination written: ..."}
{"ts": 1743800120000, "stream": "system", "content": "Session ended (exit 0) · next run in 3m 12s"}
```

**Run metadata** stored as a header line at the start of each log file, updated in-place when the run completes:
```json
{"type": "run", "id": "01HV...", "taskId": "meditate:job-post-worker", "startedAt": 1743800000000, "endedAt": 1743800120000, "exitCode": 0}
```
`endedAt` and `exitCode` are `null` while the run is in progress. `state.ts` rewrites the first line of the log file on session close. This allows structured outcome queries (last run success, duration) without parsing freeform log content.

Task IDs are deterministic: `<command>:<basename(folder)>`. Re-running `ralph heartbeat meditate <folder> --every 5` on an existing task updates the interval instead of duplicating it.

---

## CLI Command Surface

```
ralph heartbeat meditate <folder> --every <n>   # register task + run immediately
ralph heartbeat list                             # table: id, command, interval, status, last run, next run
ralph heartbeat logs <id> [--follow]             # print past run logs; --follow streams live
ralph heartbeat watch                            # live TUI: all tasks + streaming output
ralph heartbeat stop <id>                        # remove task + kill running session
ralph heartbeat pause <id>                       # suspend scheduling, keep task registered
ralph heartbeat resume <id>                      # re-enable scheduling
ralph heartbeat kill <id>                        # kill running session only, schedule stays
```

---

## IPC Protocol

JSON-lines over Unix socket. Each message is one JSON object terminated with `\n`.

**One-shot commands:**
```jsonc
// request
{"action": "list_tasks"}
// response
{"type": "tasks", "data": [{...}, ...]}

{"action": "register_task", "command": "meditate", "args": ["/abs/path"], "interval": 5}
{"type": "ok", "taskId": "meditate:job-post-worker"}

{"action": "stop_task", "taskId": "meditate:job-post-worker"}
{"type": "ok"}

{"action": "pause_task", "taskId": "meditate:job-post-worker"}
{"type": "ok"}

{"action": "resume_task", "taskId": "meditate:job-post-worker"}
{"type": "ok"}

{"action": "kill_session", "taskId": "meditate:job-post-worker"}
{"type": "ok"}
```

**Streaming commands (connection stays open):**
```jsonc
{"action": "stream_logs", "taskId": "meditate:job-post-worker", "follow": true}
// server pushes until client disconnects:
{"type": "log_line", "ts": 1743800000000, "stream": "stdout", "content": "..."}
{"type": "log_line", "ts": 1743800001000, "stream": "system", "content": "Session ended (exit 0)"}

{"action": "watch"}
// server pushes task updates + all log lines:
{"type": "task_update", "data": {"taskId": "...", "status": "running", "nextRunAt": ...}}
{"type": "log_line", "taskId": "...", "ts": ..., "stream": "stdout", "content": "..."}
```

**Error responses always carry a human-readable message:**
```jsonc
{"type": "error", "message": "Task not found: meditate:job-post-worker"}
{"type": "error", "message": "Daemon failed to start — check permissions on ~/.ralph/"}
```

---

## Watch TUI

`ralph heartbeat watch` renders a split-pane terminal UI using **Ink** (React for terminals — pure JS, no native modules).

```
┌─ Ralph Heartbeat ──────────────────────────────────────────┐
│ ID                          INTERVAL  STATUS   LAST RUN    │
│ ▶ meditate:job-post-worker    5 min   running  14:28       │
│   meditate:another-project   15 min   idle     13:45       │
└────────────────────────────────────────────────────────────┘
┌─ meditate:job-post-worker ─────────────────────────────────┐
│ [system] Session started (run abc123)                       │
│ [stdout] Now I have enough to write the illumination...     │
│ [stdout] Illumination written: 2026-04-04T1445-...md        │
│ [system] Session ended (exit 0) · next run in 3m 12s        │
└────────────────────────────────────────────────────────────┘
```

- Arrow keys select a task in the top pane
- Log output for the selected task streams in the bottom pane
- Active rows flash when new log lines arrive
- `q` exits

`ralph heartbeat logs <id> --follow` is the non-TUI alternative for piping or tmux panes.

---

## Meditate Command Changes

The scheduling half of `meditate.ts` moves to the daemon. Removed:
- `addCronEntry`, `removeCronEntry`, `buildCronLine`, `cronId`, `buildCronExpression`, `isCleanInterval`, `insertCronEntry`, `deleteCronEntry` — cron management gone entirely
- `writeSentinel`, `readSentinel`, `removeSentinel`, `MeditationSentinel` — replaced by daemon's `tasks.json`
- `meditateStop`, `meditateStatus` — replaced by `ralph heartbeat stop/pause/resume/kill`
- `--every` and `--until` options removed from `ralph meditate` CLI command. The `--until` end-time feature is intentionally dropped; it can be reintroduced later via an `endsAt` field in `tasks.json` without a migration.

Kept:
- `runMeditationSession` — session runner, called by daemon's `runner.ts` as a subprocess
- `buildMeditationArgs`, `writeMcpConfig`, `cleanupMcpConfig` — MCP config lifecycle
- `writePid`, `readPid`, `removePid`, `isPidAlive` — PID lock per session
- `ensureMeditationDirs`, `appendMeditateGitignore` — directory setup

**`index.ts` changes:**
- Remove `meditate-stop` and `meditate-status` command registrations — users redirected to `ralph heartbeat stop/kill/pause/resume`
- Remove `--every` and `--until` options from the `meditate` command registration
- `meditate-create` command is unaffected and stays registered as-is

---

## Build Changes

**`tsup.config.ts`** — add daemon entry point:
```typescript
entry: [
  "src/cli/index.ts",
  "src/cli/mcp/illumination-server.ts",
  "src/daemon/index.ts"   // new
]
```
Outputs `dist/daemon/index.js`. The shebang banner (`#!/usr/bin/env node`) is applied automatically by tsup to all entry points. `daemon-client.ts` resolves the daemon binary path at runtime as `join(__dirname, "..", "daemon", "index.js")` from the CLI's `dist/` directory.

**`tsconfig.json`** — change `rootDir` to `"src"` and extend include:
```json
{
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src/cli/**/*", "src/daemon/**/*"]
}
```
`rootDir` must change from `"src/cli"` to `"src"` — TypeScript errors if any included file falls outside `rootDir`. This does not affect tsup's output paths (tsup derives those from its entry array independently), so `dist/index.js` and `dist/daemon/index.js` remain unchanged. The `bin` field in `package.json` requires no update.

---

## Error Handling

All errors surfaced to the user are human-readable — no raw stack traces or JSON blobs.

| Scenario | Behavior |
|---|---|
| Daemon not running | CLI spawns it detached, waits up to 3s for socket, retries request. Message: `"Starting ralph daemon..."` |
| Daemon crashes mid-session | Session process continues independently (PID lock survives). Daemon restarts on next CLI command, re-reads `tasks.json`. Message: `"Daemon restarted — reconnecting..."` |
| Task already running at scheduled tick | Daemon detects live PID, skips. Log: `[system] Skipped — session still running` |
| `--every` not a clean divisor of 60 | Warning: `"Warning: 7 min does not divide 60 evenly — cron resets hourly. Prefer: 1, 2, 5, 10, 15, 20, 30, 60."` Task registered anyway. |
| Project folder missing at tick time | Log: `[system] Error: project folder not found: /path/to/project`. Task stays registered, user must stop manually. |
| Unknown task ID in CLI command | Message: `"Task not found: meditate:job-post-worker. Run 'ralph heartbeat list' to see active tasks."` |
| Socket permission error | Message: `"Daemon failed to start — check permissions on ~/.ralph/"` |

---

## Testing

| File | What it covers |
|---|---|
| `src/daemon/state.test.ts` | Task CRUD on `tasks.json`, log file append, run history on flat files |
| `src/daemon/scheduler.test.ts` | Interval firing, skip-if-running logic, pause/resume |
| `src/daemon/socket.test.ts` | IPC request/response, streaming protocol |
| `src/cli/tests/heartbeat.test.ts` | CLI → daemon client, auto-start logic |
| `src/cli/tests/meditate.test.ts` | Cron/sentinel tests removed; session runner + MCP config tests kept |
