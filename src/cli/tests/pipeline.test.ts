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
  spawnSync: vi.fn(() => ({ status: 0, stdout: "main\n" })),
}));
vi.mock("../components/PipelineApp.js", () => ({
  renderPipelineApp: vi.fn(async () => ({
    callbacks: {
      emit: vi.fn(),
      done: vi.fn(),
    },
    waitUntilExit: vi.fn(async () => {}),
  })),
}));
vi.mock("../lib/assets.js", () => ({
  getBundledPipelinePath: vi.fn((name: string) => `/fake/pipelines/${name}.dot`),
}));
vi.mock("../lib/pipeline-create-prompt.js", () => ({
  composeCreatePrompt: vi.fn().mockReturnValue("# Test prompt"),
}));
vi.mock("../lib/stream-formatter.js", () => ({
  streamEvents: vi.fn(async function* () {}),
  parseStreamJsonEvents: vi.fn(async function* () {}),
}));

import { pipelineRunCommand, pipelineValidateCommand, pipelineListCommand, pipelineCreateCommand } from "../commands/pipeline.js";
import * as childProcess from "child_process";
import { composeCreatePrompt } from "../lib/pipeline-create-prompt.js";
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

  it("calls runPipeline with parsed graph and done on success", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { logsRoot: dir });
    expect(engine.runPipeline).toHaveBeenCalledTimes(1);
    // The new adapter calls done() on PipelineApp after runPipeline resolves.
    const { renderPipelineApp } = await import("../components/PipelineApp.js");
    const mockApp = renderPipelineApp as ReturnType<typeof vi.fn>;
    const result = await mockApp.mock.results[0].value;
    expect(result.callbacks.done).toHaveBeenCalled();
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

  it("uses AutoApproveInterviewer when stdin is not a TTY", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
    try {
      const dotFile = join(dir, "test.dot");
      writeFileSync(dotFile, VALID_DOT);
      await pipelineRunCommand(dotFile, { logsRoot: dir });
      const call = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = call[1];
      expect(opts.interviewer.constructor.name).toBe("AutoApproveInterviewer");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
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

  it("passes --var values as callerContext to runPipeline", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { logsRoot: dir, variables: { specs_dir: "/tmp/specs", foo: "bar" } });
    const call = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[1];
    expect(opts.callerContext).toEqual({ specs_dir: "/tmp/specs", foo: "bar" });
  });

  it("nodes overview uses node IDs, not raw labels", async () => {
    const dot = `digraph my_pipeline {
      start [shape=Mdiamond]
      worker [shape=box]
      approval [shape=hexagon, label="Approve?\\n$some_var\\n$other_var"]
      done [shape=Msquare]
      start -> worker -> approval -> done
    }`;
    const dotFile = join(dir, "test-labels.dot");
    writeFileSync(dotFile, dot);
    await pipelineRunCommand(dotFile, { logsRoot: dir });

    // The new adapter passes node IDs directly as the `nodes` prop to renderPipelineApp.
    const { renderPipelineApp } = await import("../components/PipelineApp.js");
    const mockApp = renderPipelineApp as ReturnType<typeof vi.fn>;
    const call = mockApp.mock.calls[0][0];
    const nodes: string[] = call.nodes;

    expect(nodes).toContain("worker");
    expect(nodes).toContain("approval");
    // Must NOT contain raw label content or marker nodes
    expect(nodes.join(" ")).not.toContain("Approve?");
    expect(nodes.join(" ")).not.toContain("start");
    expect(nodes.join(" ")).not.toContain("done");
  });
});

describe("pipelineRunCommand — onInteractiveRequest", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-test-"));
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("populates session.history with assistant turns so $node.output is available downstream", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { logsRoot: dir });

    const call = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls[0];
    const capturedOnInteractive = call[1].onInteractiveRequest as
      ((req: { session: any; child: any; tracePath: string }) => Promise<void>) | undefined;

    expect(capturedOnInteractive).toBeDefined();

    const { Session } = await import("../../cli/lib/session.js");
    const { createFakeChildHandle } = await import("./helpers/fake-child-handle.js");

    const session = new Session("test-session-id");
    const ctrl = createFakeChildHandle("test-session-id");

    // Emit a result event then end the stream so the for-await loop in the callback completes
    setTimeout(() => {
      ctrl.emit({
        type: "result",
        stopReason: "end_turn",
        text: "the assistant final response",
        usage: { inputTokens: 10, outputTokens: 5 },
        raw: {},
      });
      ctrl.endStream();
    }, 5);

    await capturedOnInteractive!({ session, child: ctrl.handle, tracePath: dir });

    expect(session.history).toHaveLength(1);
    expect(session.history[0].role).toBe("assistant");
    expect((session.history[0] as any).text).toBe("the assistant final response");
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

  it("errors if claude CLI not found", async () => {
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockReturnValueOnce({ status: 1 });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineCreateCommand("review", { project: dir })).rejects.toThrow();
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("claude CLI not found"));
    exitSpy.mockRestore();
  });

  it("errors if pipelines/name.dot already exists", async () => {
    mkdirSync(join(dir, "pipelines"));
    writeFileSync(join(dir, "pipelines", "review.dot"), VALID_DOT);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineCreateCommand("review", { project: dir })).rejects.toThrow();
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("ralph pipeline refine review"));
    exitSpy.mockRestore();
  });

  it("errors on invalid pipeline name", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineCreateCommand("bad name!", { project: dir })).rejects.toThrow();
    expect(out.error).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("creates pipelines/ directory if missing and spawns claude", async () => {
    (composeCreatePrompt as ReturnType<typeof vi.fn>).mockReturnValue("# Fake prompt");
    const dotPath = join(dir, "pipelines", "review.dot");
    // Mock spawnSync: first call is `which claude` (just pass), second is the actual claude spawn
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === "which") return { status: 0 };
      // Simulate Claude writing the .dot file during the interactive session
      writeFileSync(dotPath, VALID_DOT);
      return { status: 0 };
    });
    // process.exit is called at the end with the validation exit code
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineCreateCommand("review", { project: dir })).rejects.toThrow("exit");
    expect(existsSync(join(dir, "pipelines"))).toBe(true);
    expect(childProcess.spawnSync).toHaveBeenCalled();
    exitSpy.mockRestore();
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => ({ status: 0 }));
  });
});
