import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../commands/pipeline/run.js", () => ({
  pipelineRunCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/output.js", () => ({
  header: vi.fn(),
  step: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  spinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  stream: vi.fn(),
}));

import { createProgram } from "../program";
import { pipelineRunCommand } from "../commands/pipeline/run.js";
import * as output from "../lib/output.js";

const mockPipelineRun = pipelineRunCommand as ReturnType<typeof vi.fn>;
const mockWarn = output.warn as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

describe("apparat pipeline run positional shape", () => {
  it("accepts <pipeline> <project> as two positionals", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "apparat", "pipeline", "run", "meditate", "/my/project"]);
    expect(mockPipelineRun).toHaveBeenCalledWith(
      "meditate",
      expect.objectContaining({ project: "/my/project" }),
    );
  });

  it("accepts <pipeline> with --project <folder> and prints a deprecation warning", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "apparat", "pipeline", "run", "meditate", "--project", "/my/project"]);
    expect(mockPipelineRun).toHaveBeenCalledWith(
      "meditate",
      expect.objectContaining({ project: "/my/project" }),
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringMatching(/--project.*deprecated/i),
    );
  });

  it("does NOT print the deprecation warning when the positional project is used", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "apparat", "pipeline", "run", "meditate", "/my/project"]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("positional project wins over --project flag if both are passed", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node", "apparat", "pipeline", "run", "meditate",
      "/from/positional",
      "--project", "/from/flag",
    ]);
    expect(mockPipelineRun).toHaveBeenCalledWith(
      "meditate",
      expect.objectContaining({ project: "/from/positional" }),
    );
  });
});
