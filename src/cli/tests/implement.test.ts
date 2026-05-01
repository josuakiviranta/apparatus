import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({ existsSync: vi.fn().mockReturnValue(true) }));
vi.mock("../commands/pipeline.js", () => ({
  pipelineRunCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/output.js", () => ({
  error: vi.fn(),
  info: vi.fn(),
}));

import { implementCommand } from "../commands/implement.js";
import { pipelineRunCommand } from "../commands/pipeline.js";

const mockPipeline = pipelineRunCommand as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

describe("implementCommand", () => {
  it("calls pipelineRunCommand with 'implement' and the project path", async () => {
    await implementCommand("/my/project", {});
    expect(mockPipeline).toHaveBeenCalledWith(
      "implement",
      expect.objectContaining({ project: expect.stringContaining("my/project") })
    );
  });

  it("passes max_iterations='0' by default (unlimited)", async () => {
    await implementCommand("/my/project", {});
    expect(mockPipeline).toHaveBeenCalledWith(
      "implement",
      expect.objectContaining({
        variables: expect.objectContaining({ max_iterations: "0" }),
      })
    );
  });

  it("passes --max N as max_iterations variable", async () => {
    await implementCommand("/my/project", { max: 5 });
    expect(mockPipeline).toHaveBeenCalledWith(
      "implement",
      expect.objectContaining({
        variables: expect.objectContaining({ max_iterations: "5" }),
      })
    );
  });

  it("does NOT pass specs_dir to pipeline runtime", async () => {
    await implementCommand("/my/project", {});
    expect(mockPipeline).toHaveBeenCalled();
    const opts = mockPipeline.mock.calls[0][1] as { variables: Record<string, unknown> };
    expect(opts.variables).not.toHaveProperty("specs_dir");
  });

  it("passes scenarios_dir='' by default (flag not set)", async () => {
    await implementCommand("/my/project", {});
    expect(mockPipeline).toHaveBeenCalledWith(
      "implement",
      expect.objectContaining({
        variables: expect.objectContaining({ scenarios_dir: "" }),
      })
    );
  });

  it("passes scenarios_dir from --scenarios flag when in tmux", async () => {
    const prev = process.env.TMUX;
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0";
    try {
      await implementCommand("/my/project", { scenarios: "src/tests/scenarios" });
      expect(mockPipeline).toHaveBeenCalledWith(
        "implement",
        expect.objectContaining({
          variables: expect.objectContaining({ scenarios_dir: "src/tests/scenarios" }),
        })
      );
    } finally {
      if (prev === undefined) delete process.env.TMUX; else process.env.TMUX = prev;
    }
  });

  it("rejects --scenarios outside tmux with friendly error and exits", async () => {
    const prev = process.env.TMUX;
    delete process.env.TMUX;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    try {
      await expect(
        implementCommand("/my/project", { scenarios: "src/tests/scenarios" })
      ).rejects.toThrow(/process\.exit\(1\)/);
      expect(mockPipeline).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      if (prev !== undefined) process.env.TMUX = prev;
    }
  });

  it("does not preflight tmux when --scenarios is absent", async () => {
    const prev = process.env.TMUX;
    delete process.env.TMUX;
    try {
      await implementCommand("/my/project", {});
      expect(mockPipeline).toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.TMUX = prev;
    }
  });
});
