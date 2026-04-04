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
