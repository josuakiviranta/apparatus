# Heartbeat

`src/cli/commands/heartbeat.ts` provides scheduling of recurring tasks via the background daemon. Heartbeat commands communicate with the daemon over Unix socket RPC — they do not invoke Claude directly.

## Subcommands

### `ralph heartbeat meditate <project-folder> --every <n>`

Registers a recurring meditation task. The daemon runs `ralph meditate <project-folder>` every `<n>` minutes.

- `--every <n>` is **required**
- The daemon auto-starts if not already running (via `daemon-client.ts`)
- Task ID format: `meditate:<basename-of-folder>`

### `ralph heartbeat implement <project-folder> --every <n>`

Registers a recurring implement task. The daemon runs `ralph implement <project-folder>` every `<n>` minutes.

- `--every <n>` is **required**
- Task ID format: `implement:<basename-of-folder>`

### `ralph heartbeat pipeline <dotfile> --every <n> [--project <folder>]`

Registers a recurring pipeline task. The daemon runs `ralph pipeline run <dotfile> [--project <folder>]` every `<n>` minutes.

- `--every <n>` is **required**
- `--project <folder>` is optional — passed through to the pipeline run command
- Task ID format: `pipeline:<dotfile-stem>` (e.g. `pipeline:smoke` for `smoke.dot`)
- The client computes and sends the task ID explicitly via the `id` field in `register_task`, because the daemon's default ID generation (`command:basename(args[0])`) would produce `pipeline:run` for all pipeline tasks

### `ralph heartbeat list`

Lists all registered heartbeat tasks with their status, interval, last run time, and next scheduled run.

### `ralph heartbeat stop <task-id>`

Stops and removes a registered heartbeat task from the daemon's schedule, killing any running session.

### `ralph heartbeat pause <task-id>`

Suspends scheduling for a task without removing it. The task remains in the registry with status `paused`.

### `ralph heartbeat resume <task-id>`

Re-enables scheduling for a paused task.

### `ralph heartbeat kill <task-id>`

Kills a currently running session for a task. The schedule is preserved — the task will run again at its next interval.

### `ralph heartbeat logs <task-id> [--follow]`

Shows logs for a specific heartbeat task.

- Without `--follow`: prints existing logs and exits
- With `--follow`: streams new log lines in real-time until interrupted

### `ralph heartbeat watch`

Real-time TUI dashboard showing all heartbeat tasks and their status. Uses Ink-based React TUI with keyboard navigation (up/down to select task, q to quit).

## Daemon Auto-Start

All heartbeat subcommands that require the daemon use `daemon-client.ts`, which:
1. Checks if `~/.ralph/daemon.sock` exists
2. If not, spawns the daemon detached (`spawn` with `detached: true`, `stdio: "ignore"`, `unref()`)
3. Polls for the socket file every 100ms (timeout: 3 seconds)
4. Connects and sends the RPC request

## Communication

Uses JSON-lines protocol over Unix domain socket at `~/.ralph/daemon.sock`. Each request is `{ action, ...payload }`. Responses are `{ type: "ok"|"error"|"tasks", ... }`.
