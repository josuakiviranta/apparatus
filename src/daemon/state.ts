import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Task {
  id: string;
  command: string;
  args: string[];
  interval: number;
  status: "active" | "paused" | "stopped";
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
}

export interface RunHeader {
  type: "run";
  id: string;
  taskId: string;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
}

export interface LogLine {
  ts: number;
  stream: "stdout" | "stderr" | "system";
  content: string;
}

export function getRalphDir(): string {
  const home = process.env.HOME || homedir();
  return join(home, ".ralph");
}

export function ensureDirs(): void {
  mkdirSync(join(getRalphDir(), "logs"), { recursive: true });
}

function getTasksPath(): string {
  return join(getRalphDir(), "tasks.json");
}

function getRunLogPath(taskId: string, runId: string): string {
  return join(getRalphDir(), "logs", taskId, `${runId}.log`);
}

export function readTasks(): Task[] {
  const p = getTasksPath();
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Task[];
  } catch {
    return [];
  }
}

export function writeTasks(tasks: Task[]): void {
  writeFileSync(getTasksPath(), JSON.stringify(tasks, null, 2) + "\n");
}

export function upsertTask(task: Task): void {
  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx === -1) {
    tasks.push(task);
  } else {
    tasks[idx] = task;
  }
  writeTasks(tasks);
}

export function getTask(id: string): Task | null {
  return readTasks().find((t) => t.id === id) ?? null;
}

export function deleteTask(id: string): void {
  writeTasks(readTasks().filter((t) => t.id !== id));
}

export function createRun(taskId: string, runId: string, startedAt: number): void {
  const logPath = getRunLogPath(taskId, runId);
  mkdirSync(join(getRalphDir(), "logs", taskId), { recursive: true });
  const header: RunHeader = { type: "run", id: runId, taskId, startedAt, endedAt: null, exitCode: null };
  writeFileSync(logPath, JSON.stringify(header) + "\n");
}

export function appendLogLine(taskId: string, runId: string, line: LogLine): void {
  const logPath = getRunLogPath(taskId, runId);
  appendFileSync(logPath, JSON.stringify(line) + "\n");
}

export function closeRun(taskId: string, runId: string, endedAt: number, exitCode: number): void {
  const logPath = getRunLogPath(taskId, runId);
  const content = readFileSync(logPath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim());
  const header: RunHeader = { ...JSON.parse(lines[0]), endedAt, exitCode };
  const rest = lines.slice(1);
  writeFileSync(logPath, [JSON.stringify(header), ...rest].join("\n") + "\n");
}

export function readRunLogs(taskId: string, runId: string): { header: RunHeader; lines: LogLine[] } {
  const logPath = getRunLogPath(taskId, runId);
  const content = readFileSync(logPath, "utf8");
  const [headerLine, ...rest] = content.split("\n").filter((l) => l.trim());
  return {
    header: JSON.parse(headerLine) as RunHeader,
    lines: rest.map((l) => JSON.parse(l) as LogLine),
  };
}
