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
    await implementCommand("/my/project");
    expect(mockPipeline).toHaveBeenCalledWith(
      "implement",
      expect.objectContaining({ project: expect.stringContaining("my/project") })
    );
  });

  it("does not pass a variables block — pipeline.dot defaults cover all caller inputs", async () => {
    await implementCommand("/my/project");
    expect(mockPipeline).toHaveBeenCalled();
    const opts = mockPipeline.mock.calls[0][1] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("variables");
  });
});
