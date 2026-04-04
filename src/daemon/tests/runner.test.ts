import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testHome = join(tmpdir(), `ralph-runner-test-${process.pid}`);
process.env.HOME = testHome;

import { runTask, isSessionRunning, killSession, getRalphCliPath } from "../runner";
import { ensureDirs, readRunLogs } from "../state";
import type { Task } from "../state";

beforeEach(() => {
  mkdirSync(testHome, { recursive: true });
  ensureDirs();
});
afterEach(() => rmSync(testHome, { recursive: true, force: true }));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "meditate:proj",
    command: "meditate",
    args: [testHome],
    interval: 5,
    status: "active",
    createdAt: Date.now(),
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  };
}

describe("runTask", () => {
  it("returns runId and exitCode after completion", async () => {
    const task = makeTask();
    // Override ralph CLI path to a fast no-op for testing
    vi.stubEnv("RALPH_TEST_CMD", `${process.execPath} -e "process.exit(0)"`);
    const result = await runTask(task);
    expect(result.runId).toBeTruthy();
    expect(result.exitCode).toBe(0);
    vi.unstubAllEnvs();
  });

  it("writes run header and system log lines", async () => {
    const task = makeTask();
    vi.stubEnv("RALPH_TEST_CMD", `${process.execPath} -e "process.exit(0)"`);
    const { runId } = await runTask(task);
    const { header, lines } = readRunLogs(task.id, runId);
    expect(header.exitCode).toBe(0);
    expect(header.endedAt).not.toBeNull();
    expect(lines.some((l) => l.stream === "system" && l.content.includes("Session started"))).toBe(true);
    expect(lines.some((l) => l.stream === "system" && l.content.includes("exit"))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("captures non-zero exit code", async () => {
    const task = makeTask();
    vi.stubEnv("RALPH_TEST_CMD", `${process.execPath} -e "process.exit(1)"`);
    const result = await runTask(task);
    expect(result.exitCode).toBe(1);
    vi.unstubAllEnvs();
  });
});

describe("isSessionRunning / killSession", () => {
  it("returns false when no pid file", () => {
    expect(isSessionRunning(makeTask())).toBe(false);
  });

  it("returns false when pid file has dead pid", () => {
    writeFileSync(join(testHome, ".meditate.pid"), "99999999");
    expect(isSessionRunning(makeTask())).toBe(false);
  });
});
