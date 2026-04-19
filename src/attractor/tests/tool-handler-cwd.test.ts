import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({ spawnSync: vi.fn() }));
import { spawnSync } from "child_process";
import { ToolHandler } from "../handlers/tool.js";
import type { Node, PipelineContext } from "../types.js";

const mockSpawnSync = vi.mocked(spawnSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockSpawnSync.mockReturnValue({
    status: 0, stdout: "", stderr: "", pid: 0, output: [],
    signal: null,
  } as never);
});

const meta = {
  logsRoot: "/tmp", cwd: "/tmp", dotDir: "/tmp",
  outgoingLabels: [], completedNodes: [], nodeRetries: {},
};

describe("ToolHandler — cwd passthrough", () => {
  it("passes node.cwd to spawnSync for tool_command path", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t1", type: "tool", cwd: "/expected/cwd", toolCommand: "echo hi",
    };
    await h.execute(node, { values: {} } as PipelineContext, meta as never);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "sh", ["-c", expect.any(String)],
      expect.objectContaining({ cwd: "/expected/cwd" }),
    );
  });

  it("passes node.cwd to spawnSync for script_file path", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t1", type: "tool", cwd: "/expected/cwd",
      scriptFile: "scripts/x.mjs",
    } as Node;
    await h.execute(node, { values: {} } as PipelineContext, meta as never);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "sh", ["-c", expect.any(String)],
      expect.objectContaining({ cwd: "/expected/cwd" }),
    );
  });
});
