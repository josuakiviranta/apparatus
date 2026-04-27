import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../lib/output.js", () => ({
  error: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  header: vi.fn(async () => {}),
  stream: vi.fn(async () => {}),
}));

import * as output from "../lib/output.js";
import * as pipelineMod from "../commands/pipeline.js";
import { meditateCreateCommand } from "../commands/meditate-create";

const PROJECT_DIR = join(tmpdir(), "ralph-meditate-create-test");

describe("meditateCreateCommand", () => {
  beforeAll(() => {
    mkdirSync(PROJECT_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(PROJECT_DIR)) {
      rmSync(PROJECT_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits with error if project folder does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await meditateCreateCommand(join(tmpdir(), "ralph-nonexistent-" + Date.now()));
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("project folder not found"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("delegates to pipelineRunCommand with the bundled meditate-create template + project var", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCreateCommand(PROJECT_DIR);
    expect(calls).toHaveLength(1);
    expect(calls[0].dotFile.endsWith("meditate-create/pipeline.dot")).toBe(true);
    expect(calls[0].opts.project).toBe(PROJECT_DIR);
  });
});
