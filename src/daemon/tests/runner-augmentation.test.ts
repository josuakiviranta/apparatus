import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

const testHome = join(tmpdir(), `apparat-runner-aug-test-${process.pid}`);
process.env.HOME = testHome;

import { runTask } from "../runner.js";
import { ensureDirs, readRunLogs } from "../state.js";
import type { Task } from "../state.js";

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

beforeEach(() => {
  mkdirSync(testHome, { recursive: true });
  ensureDirs();
});
afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("runTask — pipeline run argv augmentation", () => {
  it("injects --run-id and --logs-root when task is a pipeline run with --project", async () => {
    // Arrange a pipeline-run task (command="pipeline", args=["run", "<dot>", "--project", <project>])
    const project = join(testHome, "fake-project");
    mkdirSync(project, { recursive: true });
    const task = makeTask({
      id: "pipeline:fake-project",
      command: "pipeline",
      args: ["run", "smoke.dot", "--project", project],
    });

    // Stub spawn: capture argv, then synthesise immediate close
    const captured: { command: string; args: string[] }[] = [];
    vi.mocked(spawn).mockImplementation((cmd: any, args: any) => {
      captured.push({ command: cmd as string, args: args as string[] });
      const fakeChild: any = {
        pid: 99999,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev: string, cb: any) => { if (ev === "close") setImmediate(() => cb(0)); },
      };
      return fakeChild;
    });

    const { runId } = await runTask(task);

    // Assert: child argv contains --run-id <runId> and --logs-root <project>/.apparat/runs/<runId>
    expect(captured.length).toBe(1);
    const argv = captured[0].args.join(" ");
    expect(argv).toContain(`--run-id ${runId}`);
    expect(argv).toContain(`--logs-root ${join(project, ".apparat", "runs", runId)}`);
  });

  it("does NOT inject for non-pipeline tasks (e.g. meditate)", async () => {
    const project = join(testHome, "fake-project");
    mkdirSync(project, { recursive: true });
    const task = makeTask({ id: "meditate:proj", command: "meditate", args: [project] });

    const captured: { args: string[] }[] = [];
    vi.mocked(spawn).mockImplementation((_cmd: any, args: any) => {
      captured.push({ args: args as string[] });
      const fakeChild: any = {
        pid: 99999,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev: string, cb: any) => { if (ev === "close") setImmediate(() => cb(0)); },
      };
      return fakeChild;
    });

    await runTask(task);

    const argv = captured[0].args.join(" ");
    expect(argv).not.toContain("--run-id");
    expect(argv).not.toContain("--logs-root");
  });

  it("writes Engine trace breadcrumb on start and cross-link on close (pipeline-run task)", async () => {
    const project = join(testHome, "fake-project");
    mkdirSync(project, { recursive: true });
    const task = makeTask({
      id: "pipeline:fake-project",
      command: "pipeline",
      args: ["run", "smoke.dot", "--project", project],
    });

    vi.mocked(spawn).mockImplementation(() => {
      const fakeChild: any = {
        pid: 99999,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev: string, cb: any) => { if (ev === "close") setImmediate(() => cb(0)); },
      };
      return fakeChild;
    });

    const { runId } = await runTask(task);
    const { lines } = readRunLogs(task.id, runId);

    const startCrumb = lines.find((l) => l.stream === "system" && l.content.startsWith("Engine trace: "));
    const closeCrumb = lines.find((l) => l.stream === "system" && l.content.startsWith("→ apparat pipeline trace"));

    expect(startCrumb?.content).toBe(`Engine trace: ${join(project, ".apparat", "runs", runId, "pipeline.jsonl")}`);
    expect(closeCrumb?.content).toBe(`→ apparat pipeline trace ${runId} --project ${project}`);
  });
});
