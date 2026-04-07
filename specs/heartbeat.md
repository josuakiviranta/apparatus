# Heartbeat

`src/cli/commands/heartbeat.ts` provides scheduling of recurring tasks via the background daemon. Heartbeat commands communicate with the daemon over Unix socket RPC — they do not invoke Claude directly.

## Subcommands

### `ralph heartbeat meditate <project-folder> --every <n>`

Registers a recurring meditation task. The daemon runs `ralph meditate <project-folder>` every `<n>` minutes.

- `--every <n>` is **required**
- The daemon auto-starts if not already running (via `daemon-client.ts`)
- Task ID format: `meditate:<project-folder>`

### `ralph heartbeat list`

Lists all registered heartbeat tasks with their status, interval, last run time, and next scheduled run.

### `ralph heartbeat stop <task-id>`

Stops and removes a registered heartbeat task from the daemon's schedule.

### `ralph heartbeat logs <task-id> [--follow]`

Shows logs for a specific heartbeat task.

- Without `--follow`: prints existing logs and exits
- With `--follow`: streams new log lines in real-time until interrupted

### `ralph heartbeat watch`

Real-time TUI dashboard showing all heartbeat tasks and their status.

**Known issue:** Currently broken — ink's ESM/top-level-await is incompatible with tsup's ESM output.

## Daemon Auto-Start

All heartbeat subcommands that require the daemon use `daemon-client.ts`, which:
1. Checks if `~/.ralph/daemon.sock` exists
2. If not, spawns the daemon detached (`spawn` with `detached: true`, `stdio: "ignore"`, `unref()`)
3. Polls for the socket file every 100ms (timeout: 3 seconds)
4. Connects and sends the RPC request

## Communication

Uses JSON-lines protocol over Unix domain socket at `~/.ralph/daemon.sock`. Each request is `{ action, ...payload }`. Responses are `{ type: "ok"|"error"|"tasks", ... }`.
