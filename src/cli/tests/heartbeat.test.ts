// src/cli/tests/heartbeat.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerHeartbeatCommand } from "../commands/heartbeat";

// Mock daemon-client
vi.mock("../../lib/daemon-client", () => ({
  request: vi.fn(),
  stream: vi.fn(),
}));

import { request, stream } from "../../lib/daemon-client";

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevent process.exit in tests
  registerHeartbeatCommand(program);
  return program;
}

beforeEach(() => vi.clearAllMocks());

describe("ralph heartbeat list", () => {
  it("calls list_tasks and prints table", async () => {
    vi.mocked(request).mockResolvedValue({ type: "tasks", data: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync(["node", "ralph", "heartbeat", "list"]);
    expect(request).toHaveBeenCalledWith("list_tasks");
    logSpy.mockRestore();
  });
});

describe("ralph heartbeat meditate", () => {
  it("sends register_task with correct args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "meditate:proj" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "meditate", "/path/proj", "--every", "5",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      command: "meditate",
      args: [expect.stringContaining("proj")],
      interval: 5,
    });
    logSpy.mockRestore();
  });

  it("errors when --every is missing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      makeProgram().parseAsync(["node", "ralph", "heartbeat", "meditate", "/path/proj"])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });
});

describe("ralph heartbeat stop", () => {
  it("sends stop_task", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok" });
    await makeProgram().parseAsync(["node", "ralph", "heartbeat", "stop", "meditate:proj"]);
    expect(request).toHaveBeenCalledWith("stop_task", { taskId: "meditate:proj" });
  });
});

describe("ralph heartbeat implement", () => {
  it("sends register_task with correct args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "implement:proj" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "implement", "/path/proj", "--every", "10",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      command: "implement",
      args: [expect.stringContaining("proj")],
      interval: 10,
    });
    logSpy.mockRestore();
  });

  it("errors when --every is missing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      makeProgram().parseAsync(["node", "ralph", "heartbeat", "implement", "/path/proj"])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });
});

describe("ralph heartbeat run-scenarios", () => {
  it("sends register_task with correct args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "run-scenarios:proj" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "run-scenarios", "/path/proj", "--every", "60",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      command: "run-scenarios",
      args: [expect.stringContaining("proj")],
      interval: 60,
    });
    logSpy.mockRestore();
  });
});

describe("ralph heartbeat pipeline", () => {
  it("sends register_task with run subcommand args and computed id", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "pipeline", "smoke.dot",
      "--project", "/path/my-app", "--every", "30",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      id: "pipeline:smoke",
      command: "pipeline",
      args: ["run", expect.stringContaining("smoke.dot"), "--project", expect.stringContaining("my-app")],
      interval: 30,
    });
    logSpy.mockRestore();
  });

  it("errors when --every is missing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "pipeline", "smoke.dot",
        "--project", "/path/my-app",
      ])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });

  it("works without --project (pipeline handles default)", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "pipeline", "smoke.dot", "--every", "30",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", expect.objectContaining({
      command: "pipeline",
      id: "pipeline:smoke",
    }));
    logSpy.mockRestore();
  });
});
