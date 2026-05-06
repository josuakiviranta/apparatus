import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Override HOME for tests
const testHome = join(tmpdir(), `apparat-state-test-${process.pid}`);
process.env.HOME = testHome;

import {
  getApparatHome,
  ensureDirs,
  readTasks,
  writeTasks,
  upsertTask,
  getTask,
  deleteTask,
  createRun,
  appendLogLine,
  closeRun,
  readRunLogs,
} from "../state";
import type { Task, RunHeader, LogLine } from "../state";

beforeEach(() => mkdirSync(testHome, { recursive: true }));
afterEach(() => rmSync(testHome, { recursive: true, force: true }));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "meditate:my-project",
    command: "meditate",
    args: ["/abs/path/my-project"],
    interval: 5,
    status: "active",
    createdAt: 1000,
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  };
}

describe("getApparatHome", () => {
  it("returns path under HOME", () => {
    expect(getApparatHome()).toBe(join(testHome, ".apparat"));
  });
});

describe("ensureDirs", () => {
  it("creates ~/.apparat and ~/.apparat/logs", () => {
    ensureDirs();
    expect(existsSync(join(testHome, ".apparat"))).toBe(true);
    expect(existsSync(join(testHome, ".apparat", "logs"))).toBe(true);
  });
  it("is idempotent", () => {
    ensureDirs();
    ensureDirs(); // no error
  });
});

describe("task CRUD", () => {
  beforeEach(() => ensureDirs());

  it("readTasks returns [] when tasks.json missing", () => {
    expect(readTasks()).toEqual([]);
  });

  it("writeTasks + readTasks round-trips", () => {
    const tasks = [makeTask()];
    writeTasks(tasks);
    expect(readTasks()).toEqual(tasks);
  });

  it("upsertTask inserts a new task", () => {
    upsertTask(makeTask());
    expect(readTasks()).toHaveLength(1);
  });

  it("upsertTask updates an existing task by id", () => {
    upsertTask(makeTask({ interval: 5 }));
    upsertTask(makeTask({ interval: 15 }));
    const tasks = readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].interval).toBe(15);
  });

  it("getTask returns task by id", () => {
    upsertTask(makeTask());
    expect(getTask("meditate:my-project")).not.toBeNull();
  });

  it("getTask returns null for unknown id", () => {
    expect(getTask("unknown:id")).toBeNull();
  });

  it("deleteTask removes task by id", () => {
    upsertTask(makeTask());
    deleteTask("meditate:my-project");
    expect(readTasks()).toHaveLength(0);
  });

  it("deleteTask is a no-op for unknown id", () => {
    deleteTask("unknown:id"); // no error
  });

  it("upsertTask re-inserts a deleted task (documents race condition vector)", () => {
    const task = makeTask();
    upsertTask(task);
    deleteTask(task.id);
    expect(readTasks()).toHaveLength(0);
    // This is the race: a stale .then() callback calls upsertTask after delete
    upsertTask({ ...task, lastRunAt: Date.now() });
    expect(readTasks()).toHaveLength(1); // task is back — this is the bug vector
  });
});

describe("run log operations", () => {
  beforeEach(() => ensureDirs());

  it("createRun writes run header as first line", () => {
    createRun("meditate:proj", "run-001", 1000);
    const { header } = readRunLogs("meditate:proj", "run-001");
    expect(header).toMatchObject({
      type: "run",
      id: "run-001",
      taskId: "meditate:proj",
      startedAt: 1000,
      endedAt: null,
      exitCode: null,
    });
  });

  it("appendLogLine adds a line after the header", () => {
    createRun("meditate:proj", "run-001", 1000);
    appendLogLine("meditate:proj", "run-001", { ts: 1001, stream: "stdout", content: "hello" });
    const { lines } = readRunLogs("meditate:proj", "run-001");
    expect(lines).toHaveLength(1);
    expect(lines[0].content).toBe("hello");
  });

  it("closeRun rewrites header with endedAt and exitCode", () => {
    createRun("meditate:proj", "run-001", 1000);
    appendLogLine("meditate:proj", "run-001", { ts: 1001, stream: "stdout", content: "hello" });
    closeRun("meditate:proj", "run-001", 2000, 0);
    const { header, lines } = readRunLogs("meditate:proj", "run-001");
    expect(header.endedAt).toBe(2000);
    expect(header.exitCode).toBe(0);
    expect(lines).toHaveLength(1); // log lines untouched
  });
});
