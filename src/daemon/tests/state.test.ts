import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Pin ~/.apparat for tests via APPARAT_HOME (not HOME swap).
// The constant already includes the `.apparat` suffix so existing
// assertions that joined `testHome` with `.apparat` keep matching.
const testApparatHome = join(tmpdir(), `apparat-state-test-${process.pid}`, ".apparat");
process.env.APPARAT_HOME = testApparatHome;

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

beforeEach(() => {
  mkdirSync(testApparatHome, { recursive: true });
});
afterEach(() => {
  rmSync(testApparatHome, { recursive: true, force: true });
});

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
    expect(getApparatHome()).toBe(testApparatHome);
  });
});

describe("ensureDirs", () => {
  it("creates ~/.apparat and ~/.apparat/logs", () => {
    ensureDirs();
    expect(existsSync(testApparatHome)).toBe(true);
    expect(existsSync(join(testApparatHome, "logs"))).toBe(true);
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

describe("getApparatHome precedence", () => {
  let origApparatHome: string | undefined;
  let origHome: string | undefined;

  beforeEach(() => {
    origApparatHome = process.env.APPARAT_HOME;
    origHome = process.env.HOME;
  });

  afterEach(() => {
    if (origApparatHome === undefined) delete process.env.APPARAT_HOME;
    else process.env.APPARAT_HOME = origApparatHome;
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  it("returns APPARAT_HOME verbatim when set", () => {
    process.env.APPARAT_HOME = "/tmp/explicit-apparat-home";
    process.env.HOME = "/tmp/some-other-home";
    expect(getApparatHome()).toBe("/tmp/explicit-apparat-home");
  });

  it("falls back to HOME-joined-.apparat when APPARAT_HOME is unset", () => {
    delete process.env.APPARAT_HOME;
    process.env.HOME = "/tmp/operator-home";
    expect(getApparatHome()).toBe(join("/tmp/operator-home", ".apparat"));
  });

  it("falls back to homedir()+.apparat when both APPARAT_HOME and HOME are unset", () => {
    delete process.env.APPARAT_HOME;
    delete process.env.HOME;
    // homedir() is OS-dependent; just assert the suffix.
    expect(getApparatHome().endsWith(".apparat")).toBe(true);
  });

  it("returns empty string verbatim when APPARAT_HOME is empty (operator misconfig surfaces)", () => {
    process.env.APPARAT_HOME = "";
    process.env.HOME = "/tmp/should-not-be-used";
    expect(getApparatHome()).toBe("");
  });
});

describe("daemon and CLI agree on the socket path under APPARAT_HOME", () => {
  let origApparatHome: string | undefined;
  afterEach(() => {
    if (origApparatHome === undefined) delete process.env.APPARAT_HOME;
    else process.env.APPARAT_HOME = origApparatHome;
  });

  it("the daemon-client socket path resolves under APPARAT_HOME, not HOME", async () => {
    origApparatHome = process.env.APPARAT_HOME;
    process.env.APPARAT_HOME = "/tmp/socket-bridge-scratch";
    const { getDaemonSocketPath } = await import("../../lib/daemon-client.js");
    expect(getDaemonSocketPath()).toBe(join("/tmp/socket-bridge-scratch", "daemon.sock"));
  });
});
