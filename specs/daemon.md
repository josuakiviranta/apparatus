# Daemon

`src/daemon/` implements a persistent background scheduler that runs recurring tasks (e.g., meditation sessions) as child processes.

## Process Lifecycle

### Startup (`src/daemon/index.ts`)

1. Check `~/.ralph/daemon.pid` — if process alive, exit; if stale, clear
2. Call `ensureDirs()` to create `~/.ralph/logs/` and `~/.ralph/pids/`
3. Remove stale `~/.ralph/daemon.sock` if present
4. Write own PID to `~/.ralph/daemon.pid`
5. Create a `Scheduler` instance
6. Load all persisted tasks from `~/.ralph/tasks.json`; re-register active ones with the scheduler
7. Start Unix socket server via `createSocketServer()`

### Shutdown

SIGTERM/SIGINT handlers:
- Flush state to disk
- Remove PID file
- Close socket server
- Call `scheduler.destroy()` (clears all timers)

## File Layout

| Path | Purpose |
|------|---------|
| `~/.ralph/daemon.pid` | Process ID of running daemon |
| `~/.ralph/daemon.sock` | Unix domain socket for IPC |
| `~/.ralph/tasks.json` | Persisted task registry (JSON array) |
| `~/.ralph/logs/<taskId>/<runId>.log` | Per-run log files (JSON-lines) |
| `~/.ralph/pids/<safe-id>.pid` | Child process PID files (written by runner, cleaned on exit) |

## Unix Socket IPC (`src/daemon/socket.ts`)

JSON-lines protocol over Unix domain socket.

### Request Format

```json
{ "action": "<handler_name>", ...payload }
```

### Handlers (8)

| Action | Purpose | Response |
|--------|---------|----------|
| `list_tasks` | List all tasks | `{ type: "tasks", data: Task[] }` |
| `register_task` | Register a new recurring task (optional `id` field overrides auto-generated ID) | `{ type: "ok", taskId }` |
| `stop_task` | Stop and remove a task | `{ type: "ok" }` |
| `pause_task` | Pause a task (keep registration) | `{ type: "ok" }` |
| `resume_task` | Resume a paused task | `{ type: "ok" }` |
| `kill_session` | SIGTERM a running task session | `{ type: "ok" }` |
| `stream_logs` | Stream log lines (long-lived) | Multiple JSON lines |
| `watch` | Stream task events (long-lived) | Multiple JSON lines |

Error responses: `{ type: "error", message }`.

## State (`src/daemon/state.ts`)

### Task Schema

```typescript
interface Task {
  id: string;           // e.g., "meditate:my-project"
  command: string;      // CLI command name
  args: string[];       // CLI arguments
  interval: number;     // minutes between runs
  status: "active" | "paused" | "stopped";
  createdAt: string;    // ISO timestamp
  lastRunAt?: string;   // ISO timestamp
  nextRunAt?: string;   // ISO timestamp
}
```

### Run Log Format

Each log file is JSON-lines. First line is a `RunHeader`:

```typescript
interface RunHeader {
  type: "run";
  id: string;        // run ID
  taskId: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
}
```

Subsequent lines are `LogLine`:

```typescript
interface LogLine {
  ts: string;                       // ISO timestamp
  stream: "stdout" | "stderr" | "system";
  content: string;
}
```

## Scheduler (`src/daemon/scheduler.ts`)

In-memory interval timer management. Wraps `setInterval` per task.

- `register(task, onFire, isRunning?)` — sets up recurring timer; auto-unregisters existing entry for same ID
- `unregister(taskId)` — clears timer, removes entry
- `pause(taskId)` — clears interval but keeps entry
- `resume(taskId)` — re-creates interval
- `destroy()` — clears all timers

The `onFire` callback includes a skip-if-running guard via the optional `isRunning` predicate.

## Runner (`src/daemon/runner.ts`)

Spawns task commands as child processes.

- `runTask(task)` — spawns `ralph <command> <args>`, pipes stdout/stderr through `appendLogLine`, writes system log lines for start/end
- `isSessionRunning(task)` — checks `~/.ralph/pids/<safe-id>.pid` and verifies the process is alive
- `killSession(task)` — sends SIGTERM to the session PID and cleans up the PID file
- `getRalphCliPath()` — resolves the ralph binary path; respects `RALPH_TEST_CMD` env var for testing

## Client (`src/lib/daemon-client.ts`)

CLI-side daemon communication. Two modes:

- `request(action, payload)` — one-shot RPC: connect, send, read one response, disconnect
- `stream(action, payload, onData, signal?)` — streaming RPC: connect, send, read multiple lines until socket closes or AbortSignal fires

Auto-starts the daemon if `~/.ralph/daemon.sock` doesn't exist (spawn detached, poll up to 3s).
