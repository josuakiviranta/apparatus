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

import {
  pipelineRunCommand,
  pipelineValidateCommand,
  pipelineListCommand,
  pipelineCreateCommand,
  pipelineRefineCommand,
} from "../commands/pipeline.js";
import type { Graph, Node, Edge } from "../../attractor/types.js";
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

describe("pipelineRefineCommand", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-refine-"));
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => ({ status: 0 }));
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("errors if claude CLI not found", async () => {
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockReturnValueOnce({ status: 1 });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir }),
    ).rejects.toThrow();
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("claude CLI not found"));
    exitSpy.mockRestore();
  });

  it("errors when pipeline does not exist and points at create", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir }),
    ).rejects.toThrow();
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("Pipeline not found"));
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("ralph pipeline create review"));
    exitSpy.mockRestore();
  });

  it("errors on invalid pipeline name", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("bad name!", { project: dir }),
    ).rejects.toThrow();
    expect(out.error).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("injects existing .dot content verbatim into the kickoff trigger", async () => {
    mkdirSync(join(dir, "pipelines"));
    const dotPath = join(dir, "pipelines", "review.dot");
    writeFileSync(dotPath, VALID_DOT);
    (composeCreatePrompt as ReturnType<typeof vi.fn>).mockReturnValue("# Base prompt");

    const spawnMock = childProcess.spawn as ReturnType<typeof vi.fn>;
    spawnMock.mockClear();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();

    expect(spawnMock).toHaveBeenCalled();
    const args = spawnMock.mock.calls[0][1] as string[];
    const trigger = args[1];
    expect(trigger).toContain("# Base prompt");
    expect(trigger).toContain("Here is the current pipeline");
    expect(trigger).toContain("```dot");
    expect(trigger).toContain(VALID_DOT);
    expect(trigger).toContain(dotPath);
  });

  it("runs validate after a clean session exit", async () => {
    mkdirSync(join(dir, "pipelines"));
    const dotPath = join(dir, "pipelines", "review.dot");
    writeFileSync(dotPath, VALID_DOT);

    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => ({ status: 0 }));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as (code?: number | string | null | undefined) => never);
    await expect(
      pipelineRefineCommand("review", { project: dir }),
    ).rejects.toThrow("exit:0");
    expect(out.success).toHaveBeenCalledWith(expect.stringContaining("Pipeline valid"));
    exitSpy.mockRestore();
  });

  it("warns and exits non-zero if the file is gone after a clean session", async () => {
    mkdirSync(join(dir, "pipelines"));
    const dotPath = join(dir, "pipelines", "review.dot");
    writeFileSync(dotPath, VALID_DOT);

    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === "claude") rmSync(dotPath);
      return { status: 0 };
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as (code?: number | string | null | undefined) => never);
    await expect(
      pipelineRefineCommand("review", { project: dir }),
    ).rejects.toThrow("exit:1");
    expect(out.warn).toHaveBeenCalledWith(expect.stringContaining("was removed"));
    exitSpy.mockRestore();
  });

  it("exits non-zero without validating when claude resume returns non-zero", async () => {
    mkdirSync(join(dir, "pipelines"));
    const dotPath = join(dir, "pipelines", "review.dot");
    writeFileSync(dotPath, VALID_DOT);

    let nthCall = 0;
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      nthCall += 1;
      return nthCall === 1 ? { status: 0 } : { status: 2 };
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as (code?: number | string | null | undefined) => never);
    await expect(
      pipelineRefineCommand("review", { project: dir }),
    ).rejects.toThrow("exit:2");
    expect(out.success).not.toHaveBeenCalledWith(expect.stringContaining("Pipeline valid"));
    exitSpy.mockRestore();
  });
});

describe("pipelineValidateCommand — edge-label diff", () => {
  let dir: string;
  let dotPath: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-diff-"));
    dotPath = join(dir, "test.dot");
    writeFileSync(dotPath, VALID_DOT);
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  function makeNode(id: string, extra: Partial<Node> = {}): Node {
    return { id, shape: "box", ...extra } as Node;
  }
  function makeGraph(nodes: Node[], edges: Edge[]): Graph {
    return {
      name: "g",
      nodes: new Map(nodes.map(n => [n.id, n])),
      edges,
    };
  }

  it("warns on label rename with stable topology", async () => {
    // Current dot file has start->done topology — irrelevant for the diff.
    // Diff compares previousGraph (in memory) against the CURRENT parsed graph.
    // For this test, we don't need the dot to match prev/curr exactly; we want to
    // observe that diffEdgeLabels is called with the supplied previousGraph.
    // Rebuild current graph in-memory and pass via a write-then-read of a real dot.
    writeFileSync(dotPath, `digraph g {
      start [shape=Mdiamond]
      a [shape=box]
      b [shape=box]
      done [shape=Msquare]
      start -> a
      a -> b [label="approved"]
      b -> done
    }`);
    const previousGraph = makeGraph(
      [makeNode("start"), makeNode("a"), makeNode("b"), makeNode("done")],
      [
        { from: "start", to: "a" },
        { from: "a", to: "b", label: "ok" },
        { from: "b", to: "done" },
      ],
    );
    const code = await pipelineValidateCommand(dotPath, { previousGraph });
    expect(code).toBe(0);
    const warnCalls = (out.warn as ReturnType<typeof vi.fn>).mock.calls.flat();
    const hit = warnCalls.find(c => typeof c === "string" && c.includes('"ok"') && c.includes('"approved"') && c.includes("Edge labels are routing keys"));
    expect(hit).toBeTruthy();
  });

  it("errors when the old label is still referenced elsewhere", async () => {
    writeFileSync(dotPath, `digraph g {
      start [shape=Mdiamond]
      a [shape=box]
      b [shape=box]
      recovery [shape=box, agent="ok"]
      done [shape=Msquare]
      start -> a
      a -> b [label="approved"]
      b -> done
      start -> recovery
    }`);
    const previousGraph = makeGraph(
      [makeNode("start"), makeNode("a"), makeNode("b"), makeNode("recovery", { agent: "ok" }), makeNode("done")],
      [
        { from: "start", to: "a" },
        { from: "a", to: "b", label: "ok" },
        { from: "b", to: "done" },
        { from: "start", to: "recovery" },
      ],
    );
    const code = await pipelineValidateCommand(dotPath, { previousGraph });
    expect(code).toBe(1);
    const errorCalls = (out.error as ReturnType<typeof vi.fn>).mock.calls.flat();
    const hit = errorCalls.find(c => typeof c === "string" && c.includes('"ok"') && c.includes("routing keys"));
    expect(hit).toBeTruthy();
  });

  it("emits no rename diagnostic when topology changed", async () => {
    writeFileSync(dotPath, `digraph g {
      start [shape=Mdiamond]
      a [shape=box]
      c [shape=box]
      done [shape=Msquare]
      start -> a
      a -> c [label="approved"]
      c -> done
    }`);
    const previousGraph = makeGraph(
      [makeNode("start"), makeNode("a"), makeNode("b"), makeNode("done")],
      [
        { from: "start", to: "a" },
        { from: "a", to: "b", label: "ok" },
        { from: "b", to: "done" },
      ],
    );
    const code = await pipelineValidateCommand(dotPath, { previousGraph });
    expect(code).toBe(0);
    const warnCalls = (out.warn as ReturnType<typeof vi.fn>).mock.calls.flat();
    const renameWarn = warnCalls.find(c => typeof c === "string" && c.includes("routing keys"));
    expect(renameWarn).toBeFalsy();
  });

  it("emits no diagnostic when label is identical", async () => {
    writeFileSync(dotPath, `digraph g {
      start [shape=Mdiamond]
      a [shape=box]
      b [shape=box]
      done [shape=Msquare]
      start -> a
      a -> b [label="ok"]
      b -> done
    }`);
    const previousGraph = makeGraph(
      [makeNode("start"), makeNode("a"), makeNode("b"), makeNode("done")],
      [
        { from: "start", to: "a" },
        { from: "a", to: "b", label: "ok" },
        { from: "b", to: "done" },
      ],
    );
    const code = await pipelineValidateCommand(dotPath, { previousGraph });
    expect(code).toBe(0);
    const warnCalls = (out.warn as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(warnCalls.find(c => typeof c === "string" && c.includes("routing keys"))).toBeFalsy();
  });

  it("emits no diff diagnostic when previousGraph is omitted", async () => {
    writeFileSync(dotPath, `digraph g {
      start [shape=Mdiamond]
      a [shape=box]
      b [shape=box]
      done [shape=Msquare]
      start -> a
      a -> b [label="approved"]
      b -> done
    }`);
    const code = await pipelineValidateCommand(dotPath);
    expect(code).toBe(0);
    const warnCalls = (out.warn as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(warnCalls.find(c => typeof c === "string" && c.includes("routing keys"))).toBeFalsy();
  });
});

describe("pipelineRefineCommand — trace injection", () => {
  let dir: string;
  let tracesRoot: string;

  function seedTrace(runId: string, pipelineName: string, mtimeOffsetMs = 0): string {
    const traceDir = join(tracesRoot, runId);
    mkdirSync(traceDir, { recursive: true });
    const tracePath = join(traceDir, "pipeline.jsonl");
    const events = [
      { kind: "pipeline-start", runId, pipelineName, goal: "test goal", nodes: ["start", "work", "done"], timestamp: new Date(Date.now() + mtimeOffsetMs).toISOString() },
      { kind: "node-start", nodeReceiveId: "n1", nodeId: "work", nodeKind: "agent", timestamp: new Date().toISOString(), contextSnapshot: {} },
      { kind: "node-end", nodeReceiveId: "n1", nodeId: "work", success: true, contextUpdates: {} },
      { kind: "pipeline-end", runId, outcome: "success", timestamp: new Date().toISOString() },
    ];
    writeFileSync(tracePath, events.map(e => JSON.stringify(e)).join("\n") + "\n");
    if (mtimeOffsetMs !== 0) {
      const t = (Date.now() + mtimeOffsetMs) / 1000;
      // utimesSync expects seconds since epoch
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("fs").utimesSync(tracePath, t, t);
    }
    return tracePath;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-refine-traces-"));
    tracesRoot = mkdtempSync(join(tmpdir(), "ralph-traces-"));
    mkdirSync(join(dir, "pipelines"));
    writeFileSync(join(dir, "pipelines", "review.dot"), VALID_DOT);
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => ({ status: 0 }));
    (composeCreatePrompt as ReturnType<typeof vi.fn>).mockReturnValue("# Base prompt");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true });
    rmSync(tracesRoot, { recursive: true });
  });

  function captureTrigger(): string {
    const spawnMock = childProcess.spawn as ReturnType<typeof vi.fn>;
    const args = spawnMock.mock.calls[0][1] as string[];
    return args[1];
  }

  it("includes trace digests in trigger when traces exist", async () => {
    seedTrace("run-1", "review");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    const trigger = captureTrigger();
    expect(trigger).toContain("Recent run traces for review:");
    expect(trigger).toContain("run-1");
  });

  it("caps injection at REFINE_TRACE_COUNT (3)", async () => {
    seedTrace("run-old-1", "review", -50000);
    seedTrace("run-old-2", "review", -40000);
    seedTrace("run-mid",   "review", -30000);
    seedTrace("run-new-1", "review", -20000);
    seedTrace("run-new-2", "review", -10000);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    const trigger = captureTrigger();
    // 3 newest must appear
    expect(trigger).toContain("run-new-2");
    expect(trigger).toContain("run-new-1");
    expect(trigger).toContain("run-mid");
    // 2 oldest must NOT appear
    expect(trigger).not.toContain("run-old-1");
    expect(trigger).not.toContain("run-old-2");
  });

  it("skips the trace block entirely when no traces exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    const trigger = captureTrigger();
    expect(trigger).not.toContain("Recent run traces");
  });

  it("honors --no-traces option", async () => {
    seedTrace("run-1", "review");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot, traces: false }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    const trigger = captureTrigger();
    expect(trigger).not.toContain("Recent run traces");
  });

  it("trace block precedes the current-graph block", async () => {
    seedTrace("run-1", "review");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    const trigger = captureTrigger();
    const tracesIdx = trigger.indexOf("Recent run traces");
    const graphIdx  = trigger.indexOf("Here is the current pipeline");
    expect(tracesIdx).toBeGreaterThanOrEqual(0);
    expect(graphIdx).toBeGreaterThanOrEqual(0);
    expect(tracesIdx).toBeLessThan(graphIdx);
  });

  it("filters traces by pipelineName (does not leak other pipelines)", async () => {
    seedTrace("run-deploy", "deploy");
    seedTrace("run-review", "review");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    const trigger = captureTrigger();
    expect(trigger).toContain("run-review");
    expect(trigger).not.toContain("run-deploy");
  });
});
