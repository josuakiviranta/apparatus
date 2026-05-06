// src/daemon/index.ts
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import net from "net";
import { ensureDirs, readTasks, upsertTask, deleteTask, getTask, listRuns, readRunLogs } from "./state";
import { Scheduler } from "./scheduler";
import { runTask, isSessionRunning, killSession } from "./runner";
import { createSocketServer } from "./socket";
import type { Task } from "./state";

const apparatHome = join(process.env.HOME || homedir(), ".apparat");
const pidPath = join(apparatHome, "daemon.pid");
const sockPath = join(apparatHome, "daemon.sock");

// ── Prevent duplicate daemons ────────────────────────────────────────────────
if (existsSync(pidPath)) {
  const existing = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  try {
    process.kill(existing, 0);
    process.exit(0); // already running
  } catch {
    // stale PID — continue
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────
ensureDirs();
if (existsSync(sockPath)) unlinkSync(sockPath); // remove stale socket
writeFileSync(pidPath, String(process.pid));

const scheduler = new Scheduler();

// Watch connections for push-streaming
const watchListeners = new Set<(event: object) => void>();
const deletedTasks = new Set<string>();
function broadcast(event: object): void {
  for (const fn of watchListeners) fn(event);
}

function dispatchTask(task: Task): void {
  if (isSessionRunning(task)) {
    console.log(`[daemon] Skipped ${task.id} — session still running`);
    broadcast({ type: "log_line", taskId: task.id, ts: Date.now(), stream: "system", content: "Skipped — session still running" });
    return;
  }
  // Update task state
  const updated: Task = { ...task, lastRunAt: Date.now(), nextRunAt: Date.now() + task.interval * 60 * 1000 };
  upsertTask(updated);
  broadcast({ type: "task_update", data: updated });

  runTask(task).then(({ exitCode }) => {
    if (deletedTasks.has(task.id)) return;
    const finished: Task = { ...updated, lastRunAt: Date.now() };
    upsertTask(finished);
    broadcast({ type: "task_update", data: finished });
  }).catch((err) => {
    console.error(`[daemon] Task ${task.id} error:`, err);
  });
}

// Resume all active tasks from state
for (const task of readTasks()) {
  if (task.status === "active") {
    scheduler.register(task, dispatchTask);
    // Fire immediately on daemon start for active tasks
    dispatchTask(task);
  }
}

const server = createSocketServer(sockPath, {
  list_tasks: () => readTasks(),

  register_task: (command, args, interval, id) => {
    const taskId = id ?? `${command}:${basename(args[0])}`;
    deletedTasks.delete(taskId);
    const existing = getTask(taskId);
    const task: Task = {
      id: taskId,
      command,
      args,
      interval,
      status: "active",
      createdAt: existing?.createdAt ?? Date.now(),
      lastRunAt: existing?.lastRunAt ?? null,
      nextRunAt: Date.now() + interval * 60 * 1000,
    };
    upsertTask(task);
    scheduler.register(task, dispatchTask);
    dispatchTask(task); // run immediately
    broadcast({ type: "task_update", data: task });
    return task;
  },

  stop_task: (taskId) => {
    const task = getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}. Run 'apparat heartbeat list' to see active tasks.`);
    scheduler.unregister(taskId);
    if (isSessionRunning(task)) killSession(task);
    deletedTasks.add(taskId);
    deleteTask(taskId);
    broadcast({ type: "task_update", data: { ...task, status: "stopped" } });
  },

  pause_task: (taskId) => {
    const task = getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}. Run 'apparat heartbeat list' to see active tasks.`);
    scheduler.pause(taskId);
    const updated = { ...task, status: "paused" as const };
    upsertTask(updated);
    broadcast({ type: "task_update", data: updated });
  },

  resume_task: (taskId) => {
    const task = getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}. Run 'apparat heartbeat list' to see active tasks.`);
    scheduler.resume(taskId);
    const updated = { ...task, status: "active" as const };
    upsertTask(updated);
    broadcast({ type: "task_update", data: updated });
  },

  kill_session: (taskId) => {
    const task = getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}. Run 'apparat heartbeat list' to see active tasks.`);
    if (!killSession(task)) throw new Error(`No active session for: ${taskId}`);
  },

  stream_logs: (taskId, follow, onLine) => {
    const runs = listRuns(taskId);
    if (runs.length === 0) {
      onLine({ type: "logs", taskId, runs: [], message: "No log runs found for this task." });
      return () => {};
    }
    const latestRunId = runs[runs.length - 1];
    const { header, lines } = readRunLogs(taskId, latestRunId);
    if (!follow) {
      onLine({ type: "logs", taskId, runId: latestRunId, header, lines });
      return () => {};
    }
    // follow mode: send existing lines first, then stream new ones via broadcast
    for (const line of lines) {
      onLine({ type: "log_line", taskId, ...line });
    }
    const listener = (event: object) => {
      if ((event as any).type === "log_line" && (event as any).taskId === taskId) {
        onLine(event);
      }
    };
    watchListeners.add(listener);
    return () => watchListeners.delete(listener);
  },

  watch: (onEvent) => {
    watchListeners.add(onEvent);
    // Send current task list immediately
    for (const t of readTasks()) onEvent({ type: "task_update", data: t });
    return () => watchListeners.delete(onEvent);
  },
});

server.listen(sockPath, () => {
  console.log(`[daemon] Listening on ${sockPath}`);
});

// ── Shutdown ─────────────────────────────────────────────────────────────────
function shutdown(): void {
  scheduler.destroy();
  server.close();
  try { unlinkSync(sockPath); } catch {}
  try { unlinkSync(pidPath); } catch {}
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
