import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import * as pipelineMod from "../commands/pipeline.js";
import { planCommand } from "../commands/plan.js";

const PROJECT_DIR = "/tmp/some-project";

describe("planCommand (shim)", () => {
  beforeAll(() => {
    mkdirSync(PROJECT_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(PROJECT_DIR)) {
      rmSync(PROJECT_DIR, { recursive: true, force: true });
    }
  });

  it("delegates to pipelineRunCommand with the bundled plan template + project var", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await planCommand(PROJECT_DIR);
    expect(calls).toHaveLength(1);
    expect(calls[0].dotFile.endsWith("plan/pipeline.dot")).toBe(true);
    expect(calls[0].opts.project).toBe(PROJECT_DIR);
  });
});
