import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../attractor/core/engine.js", () => ({
  runPipeline: vi.fn(async () => ({ status: "success", completedNodes: ["start", "done"], context: {} })),
}));
vi.mock("../../attractor/core/graph.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../attractor/core/graph.js")>();
  return { ...actual };
});
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
    callbacks: { emit: vi.fn(), done: vi.fn() },
    waitUntilExit: vi.fn(async () => {}),
  })),
}));
vi.mock("../lib/assets.js", () => ({}));
vi.mock("../lib/pipeline-create-prompt.js", () => ({
  composeCreatePrompt: vi.fn().mockReturnValue("# Test prompt"),
}));
vi.mock("../lib/stream-formatter.js", () => ({
  streamEvents: vi.fn(async function* () {}),
  parseStreamJsonEvents: vi.fn(async function* () {}),
}));

import { pipelineRunCommand } from "../commands/pipeline.js";

const MISSING_INPUTS_DOT = `digraph g {
  goal="test"
  inputs="foo"
  start [shape=Mdiamond]
  a [shape=parallelogram, tool_command="echo $foo"]
  done [shape=Msquare]
  start -> a -> done
}`;

const SUCCESS_DOT = `digraph g {
  goal="ok"
  start [shape=Mdiamond]
  a [agent="implement", prompt="noop"]
  done [shape=Msquare]
  start -> a -> done
}`;

function findTipLine(spy: ReturnType<typeof vi.spyOn>): string | undefined {
  return spy.mock.calls
    .map((c) => c[0])
    .find((line): line is string => typeof line === "string" && line.startsWith("Tip: ralph pipeline refine"));
}

describe("pipelineRunCommand refine tip", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let logSpy: any;
  let dir: string;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), "ralph-tip-test-"));
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints tip when declared inputs are missing", async () => {
    const dotPath = join(dir, "needs-foo.dot");
    writeFileSync(dotPath, MISSING_INPUTS_DOT);

    await expect(pipelineRunCommand(dotPath, { logsRoot: dir })).rejects.toThrow("process.exit called");

    const tipLine = findTipLine(logSpy);
    expect(tipLine).toBeDefined();
    expect(tipLine).toContain("needs-foo");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT print tip when the dot file does not exist", async () => {
    const dotPath = join(dir, "does-not-exist.dot");

    await expect(pipelineRunCommand(dotPath, { logsRoot: dir })).rejects.toThrow("process.exit called");

    expect(findTipLine(logSpy)).toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT print tip on success", async () => {
    const dotPath = join(dir, "ok.dot");
    writeFileSync(dotPath, SUCCESS_DOT);

    await pipelineRunCommand(dotPath, { logsRoot: dir, project: dir });

    expect(findTipLine(logSpy)).toBeUndefined();
  });

  it("uses shorthand name verbatim when invoked as a shorthand", async () => {
    const pipelinesDir = join(dir, "pipelines");
    mkdirSync(pipelinesDir, { recursive: true });
    writeFileSync(join(pipelinesDir, "myflow.dot"), MISSING_INPUTS_DOT);

    await expect(pipelineRunCommand("myflow", { logsRoot: dir, project: dir })).rejects.toThrow(
      "process.exit called",
    );

    const tipLine = findTipLine(logSpy);
    expect(tipLine).toBeDefined();
    expect(tipLine).toContain("ralph pipeline refine myflow ");
  });

  it("prints tip after engine failure, after Ink unmounts", async () => {
    const { runPipeline } = await import("../../attractor/core/engine.js");
    (runPipeline as unknown as { mockImplementationOnce: (fn: () => unknown) => void })
      .mockImplementationOnce(async () => ({
        status: "fail",
        failureReason: "synthetic",
        completedNodes: [],
        context: {},
      }));

    const dotPath = join(dir, "will-fail.dot");
    writeFileSync(dotPath, SUCCESS_DOT);

    await expect(pipelineRunCommand(dotPath, { logsRoot: dir, project: dir })).rejects.toThrow("process.exit called");

    const tipLine = findTipLine(logSpy);
    expect(tipLine).toBeDefined();
    expect(tipLine).toContain("will-fail");
  });
});
