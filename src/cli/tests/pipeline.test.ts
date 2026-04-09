import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../attractor/core/engine.js", () => ({
  runPipeline: vi.fn(async () => ({ status: "success", completedNodes: ["start", "done"], context: {} })),
}));
vi.mock("../../attractor/core/graph.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../attractor/core/graph.js")>();
  return { ...actual };
});
vi.mock("../lib/loop.js", () => ({
  runLoop: vi.fn(async () => ({ success: true, iterations: 1, exitReason: "completed" })),
}));
vi.mock("../lib/output.js", () => ({
  error: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  stream: vi.fn(async () => {}),
}));
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: () => void) => { if (event === "close") cb(); }),
  })),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));
vi.mock("../lib/assets.js", () => ({
  getPipelineCreatePromptPath: vi.fn(() => "/fake/PROMPT_pipeline_create.md"),
}));
vi.mock("../lib/stream-formatter.js", () => ({
  streamEvents: vi.fn(async function* () {}),
}));

import { pipelineRunCommand, pipelineValidateCommand, pipelineListCommand, pipelineCreateCommand } from "../commands/pipeline.js";
import * as childProcess from "child_process";
import { getPipelineCreatePromptPath } from "../lib/assets.js";
import * as engine from "../../attractor/core/engine.js";
import * as out from "../lib/output.js";

const VALID_DOT = `digraph g {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  start -> done
}`;

describe("pipelineValidateCommand", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-test-")); });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("returns 0 for a valid dot file", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    const code = await pipelineValidateCommand(dotFile);
    expect(code).toBe(0);
    expect(out.success).toHaveBeenCalled();
  });

  it("returns 1 for a dot file with validation errors", async () => {
    const dotFile = join(dir, "bad.dot");
    writeFileSync(dotFile, `digraph g { work [shape=box] }`);
    const code = await pipelineValidateCommand(dotFile);
    expect(code).toBe(1);
  });

  it("returns 1 if file does not exist", async () => {
    const code = await pipelineValidateCommand(join(dir, "missing.dot"));
    expect(code).toBe(1);
    expect(out.error).toHaveBeenCalled();
  });

  it("resolves name shorthand to pipelines/ path", async () => {
    mkdirSync(join(dir, "pipelines"));
    writeFileSync(join(dir, "pipelines", "review.dot"), VALID_DOT);
    const code = await pipelineValidateCommand("review", { project: dir });
    expect(code).toBe(0);
  });
});

describe("pipelineRunCommand", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-test-"));
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("calls runPipeline with parsed graph", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { logsRoot: dir });
    expect(engine.runPipeline).toHaveBeenCalledTimes(1);
    expect(out.success).toHaveBeenCalled();
  });

  it("exits 1 if dotFile does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineRunCommand(join(dir, "nope.dot"), { logsRoot: dir })).rejects.toThrow();
    exitSpy.mockRestore();
  });

  it("resolves name shorthand to pipelines/ path", async () => {
    mkdirSync(join(dir, "pipelines"));
    writeFileSync(join(dir, "pipelines", "review.dot"), VALID_DOT);
    await pipelineRunCommand("review", { project: dir, logsRoot: dir });
    expect(engine.runPipeline).toHaveBeenCalledTimes(1);
  });

  it("uses stable slug-based logsRoot when none provided", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile);
    const call = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[1];
    // logsRoot should be ~/.ralph/runs/<slug>, not contain a timestamp
    expect(opts.logsRoot).toContain(join(".ralph", "runs", "g"));
    expect(opts.logsRoot).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("pipelineListCommand", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-test-"));
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("prints message when pipelines/ does not exist", async () => {
    await pipelineListCommand({ project: dir });
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining("ralph pipeline create"));
  });

  it("prints message when pipelines/ is empty", async () => {
    mkdirSync(join(dir, "pipelines"));
    await pipelineListCommand({ project: dir });
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining("ralph pipeline create"));
  });

  it("lists .dot files with their goal attribute", async () => {
    mkdirSync(join(dir, "pipelines"));
    writeFileSync(join(dir, "pipelines", "review.dot"),
      `digraph g {\n  goal="Run review"\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`);
    writeFileSync(join(dir, "pipelines", "deploy.dot"),
      `digraph g {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`);
    await pipelineListCommand({ project: dir });
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining("review"));
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining("Run review"));
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining("deploy"));
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining("no goal defined"));
  });
});

describe("pipelineCreateCommand", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-test-"));
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("errors if pipelines/name.dot already exists", async () => {
    mkdirSync(join(dir, "pipelines"));
    writeFileSync(join(dir, "pipelines", "review.dot"), VALID_DOT);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineCreateCommand("review", { project: dir })).rejects.toThrow();
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    exitSpy.mockRestore();
  });

  it("errors on invalid pipeline name", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineCreateCommand("bad name!", { project: dir })).rejects.toThrow();
    expect(out.error).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("creates pipelines/ directory if missing and spawns claude", async () => {
    const promptFile = join(dir, "fake-prompt.md");
    writeFileSync(promptFile, "# Fake prompt");
    (getPipelineCreatePromptPath as ReturnType<typeof vi.fn>).mockReturnValue(promptFile);
    const dotPath = join(dir, "pipelines", "review.dot");
    // Mock spawnSync to create the .dot file as a side effect (simulating Claude writing it)
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      writeFileSync(dotPath, VALID_DOT);
      return { status: 0 };
    });
    // process.exit is called at the end with the validation exit code
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineCreateCommand("review", { project: dir })).rejects.toThrow("exit");
    expect(existsSync(join(dir, "pipelines"))).toBe(true);
    expect(childProcess.spawnSync).toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
