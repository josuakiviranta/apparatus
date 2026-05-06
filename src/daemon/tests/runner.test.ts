import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testHome = join(tmpdir(), `apparat-runner-test-${process.pid}`);
process.env.HOME = testHome;

import { runTask, isSessionRunning, killSession } from "../runner";
import { ensureDirs, readRunLogs, getPidFilePath } from "../state";
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
    // Override apparat CLI path to a fast no-op for testing
    vi.stubEnv("APPARAT_TEST_CMD", `${process.execPath} -e "process.exit(0)"`);
    const result = await runTask(task);
    expect(result.runId).toBeTruthy();
    expect(result.exitCode).toBe(0);
    vi.unstubAllEnvs();
  });

  it("writes run header and system log lines", async () => {
    const task = makeTask();
    vi.stubEnv("APPARAT_TEST_CMD", `${process.execPath} -e "process.exit(0)"`);
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
    vi.stubEnv("APPARAT_TEST_CMD", `${process.execPath} -e "process.exit(1)"`);
    const result = await runTask(task);
    expect(result.exitCode).toBe(1);
    vi.unstubAllEnvs();
  });
});

describe("env var stripping", () => {
  it("does not pass CLAUDECODE to spawned process", async () => {
    const task = makeTask();
    // Simulate being inside a Claude Code session
    process.env.CLAUDECODE = "1";
    // Spawned command exits 1 if CLAUDECODE is present, 0 if stripped
    vi.stubEnv(
      "APPARAT_TEST_CMD",
      `${process.execPath} -e "process.exit(process.env.CLAUDECODE ? 1 : 0)"`,
    );
    const result = await runTask(task);
    expect(result.exitCode).toBe(0);
    vi.unstubAllEnvs();
    delete process.env.CLAUDECODE;
  });

  it("does not pass CLAUDE_CODE_ENTRYPOINT to spawned process", async () => {
    const task = makeTask();
    process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
    vi.stubEnv(
      "APPARAT_TEST_CMD",
      `${process.execPath} -e "process.exit(process.env.CLAUDE_CODE_ENTRYPOINT ? 1 : 0)"`,
    );
    const result = await runTask(task);
    expect(result.exitCode).toBe(0);
    vi.unstubAllEnvs();
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
  });
});

describe("isSessionRunning / killSession", () => {
  it("returns false when no pid file", () => {
    expect(isSessionRunning(makeTask())).toBe(false);
  });

  it("returns false when pid file has dead pid", () => {
    writeFileSync(getPidFilePath("meditate:proj"), "99999999");
    expect(isSessionRunning(makeTask())).toBe(false);
  });

  it("runTask writes pid file during execution and cleans up after", async () => {
    const task = makeTask();
    vi.stubEnv(
      "APPARAT_TEST_CMD",
      `${process.execPath} -e "setTimeout(() => process.exit(0), 50)"`,
    );
    const runPromise = runTask(task);
    // Give child a moment to spawn
    await new Promise((r) => setTimeout(r, 20));
    // PID file should exist while running
    expect(existsSync(getPidFilePath(task.id))).toBe(true);
    await runPromise;
    // PID file should be gone after exit
    expect(existsSync(getPidFilePath(task.id))).toBe(false);
    vi.unstubAllEnvs();
  });
});
