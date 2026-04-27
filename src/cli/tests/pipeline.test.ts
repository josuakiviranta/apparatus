import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
// (mkdirSync is also used by resume tests below to seed run directories)
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
  resolveBundledTemplate: vi.fn((name: string) => `/fake/templates/${name}/pipeline.dot`),
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
import * as pipelineMod from "../commands/pipeline.js";
import type { Graph, Node, Edge } from "../../attractor/types.js";
import * as engine from "../../attractor/core/engine.js";
import * as out from "../lib/output.js";

const VALID_DOT = `digraph g {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  start -> done
}`;

describe("pipelineValidateCommand", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-test-"));
  });
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

  it("wires dotDir through so script_file_exists fires on missing script", async () => {
    // This test proves validateGraph is invoked with dirname(absPath): the
    // script_file_exists diagnostic is ONLY emitted when dotDir is non-undefined.
    const dotFile = join(dir, "scripts-missing.dot");
    writeFileSync(dotFile, `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      t [type="tool", cwd="$project", script_file="scripts/missing.mjs"]
      start -> t -> done
    }`);
    const code = await pipelineValidateCommand(dotFile);
    expect(code).toBe(1);
    const errorCalls = (out.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const messages = errorCalls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("[script_file_exists]"))).toBe(true);
    expect(messages.some((m) => m.includes("scripts/missing.mjs"))).toBe(true);
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
    await pipelineRunCommand(dotFile, { logsRoot: dir, project: dir });
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
      await pipelineRunCommand(dotFile, { logsRoot: dir, project: dir });
      const call = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = call[1];
      expect(opts.interviewer.constructor.name).toBe("AutoApproveInterviewer");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });

  it("places logsRoot under ~/.ralph/<projectKey>/runs/<runId> when none provided", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { project: dir });
    const call = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[1];
    // logsRoot shape: <ralph-root>/<basename>-<6hex>/runs/<8hex runId>
    expect(opts.logsRoot).toMatch(
      new RegExp(`\\.ralph[\\\\/].+-[0-9a-f]{6}[\\\\/]runs[\\\\/][0-9a-f]{8}$`),
    );
    expect(opts.logsRoot).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("passes --var values as callerContext to runPipeline", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { logsRoot: dir, project: dir, variables: { specs_dir: "/tmp/specs", foo: "bar" } });
    const call = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[1];
    expect(opts.callerContext).toEqual({ specs_dir: "/tmp/specs", foo: "bar" });
  });

  it("nodes overview uses node IDs, not raw labels", async () => {
    const dot = `digraph my_pipeline {
      start [shape=Mdiamond]
      worker [shape=box, agent="noop", prompt="noop"]
      approval [shape=hexagon, label="Approve?\\n$some_var\\n$other_var"]
      done [shape=Msquare]
      start -> worker -> approval -> done
    }`;
    const dotFile = join(dir, "test-labels.dot");
    writeFileSync(dotFile, dot);
    await pipelineRunCommand(dotFile, { logsRoot: dir, project: dir });

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

describe("pipelineRunCommand — --resume resolution", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-resume-"));
    process.env.RALPH_RUNS_ROOT = dir;
  });
  afterEach(() => {
    delete process.env.RALPH_RUNS_ROOT;
    rmSync(dir, { recursive: true });
  });

  it("auto-selects the only run when --resume is bare and one run exists", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { project: dir });
    const calls = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls;
    const firstLogsRoot = calls[0][1].logsRoot as string;
    // engine is mocked → no dir created on disk; seed manually so resolver finds it.
    mkdirSync(firstLogsRoot, { recursive: true });

    await pipelineRunCommand(dotFile, { project: dir, resume: true });
    const secondLogsRoot = calls[calls.length - 1][1].logsRoot as string;
    expect(secondLogsRoot).toBe(firstLogsRoot);
  });

  it("errors when --resume is bare and >1 runs exist", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { project: dir });
    const calls = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls;
    const firstLogsRoot = calls[0][1].logsRoot as string;
    mkdirSync(firstLogsRoot, { recursive: true });
    await pipelineRunCommand(dotFile, { project: dir });
    const secondLogsRoot = calls[1][1].logsRoot as string;
    mkdirSync(secondLogsRoot, { recursive: true });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_c?: number) => {
      throw new Error("__exit__");
    }) as never);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(
        pipelineRunCommand(dotFile, { project: dir, resume: true }),
      ).rejects.toThrow("__exit__");
      const err = (errSpy.mock.calls.map(c => String(c[0])).join(""));
      expect(err).toMatch(/multiple runs|--resume <runId>/i);
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("loads the explicit runId when --resume <runId> is given", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { project: dir });
    const firstCall = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls[0];
    const firstLogsRoot = firstCall[1].logsRoot as string;
    mkdirSync(firstLogsRoot, { recursive: true });
    const targetRunId = firstLogsRoot.split(/[\\/]/).pop()!;

    await pipelineRunCommand(dotFile, { project: dir, resume: targetRunId });
    const calls = (engine.runPipeline as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1][1].logsRoot).toBe(firstLogsRoot);
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
    await pipelineRunCommand(dotFile, { logsRoot: dir, project: dir });

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

describe("pipelineCreateCommand (shim)", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-test-"));
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("delegates to pipelineRunCommand with the bundled pipeline-create template + pipeline_name var", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    const spy = vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await pipelineCreateCommand("review", { project: dir });
    expect(calls).toHaveLength(1);
    expect(calls[0].dotFile.endsWith("pipeline-create/pipeline.dot")).toBe(true);
    expect(calls[0].opts.variables.pipeline_name).toBe("review");
    expect(calls[0].opts.variables.pipelines_dir).toBe(join(dir, "pipelines"));
    spy.mockRestore();
  });
});

describe("pipelineRefineCommand", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-refine-"));
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

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

  it("delegates to pipelineRunCommand with the pipeline-refine template + variables", async () => {
    mkdirSync(join(dir, "pipelines"));
    const dotPath = join(dir, "pipelines", "review.dot");
    writeFileSync(dotPath, VALID_DOT);

    const calls: Array<{ dotFile: string; opts: { project?: string; variables?: Record<string, string> } }> = [];
    const runSpy = vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts: opts ?? {} });
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as (code?: number | string | null | undefined) => never);
    await expect(
      pipelineRefineCommand("review", { project: dir }),
    ).rejects.toThrow("exit:0");
    exitSpy.mockRestore();
    runSpy.mockRestore();

    expect(calls).toHaveLength(1);
    expect(calls[0].dotFile.endsWith("pipeline-refine/pipeline.dot")).toBe(true);
    expect(calls[0].opts.project).toBe(dir);
    const vars = calls[0].opts.variables ?? {};
    expect(vars.pipeline_name).toBe("review");
    expect(vars.dot_path).toBe(dotPath);
    expect(vars.current_dot).toBe(VALID_DOT);
    expect(typeof vars.trace_digest).toBe("string");
  });

  it("runs validate after a clean session exit", async () => {
    mkdirSync(join(dir, "pipelines"));
    const dotPath = join(dir, "pipelines", "review.dot");
    writeFileSync(dotPath, VALID_DOT);

    const runSpy = vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async () => {});

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as (code?: number | string | null | undefined) => never);
    await expect(
      pipelineRefineCommand("review", { project: dir }),
    ).rejects.toThrow("exit:0");
    expect(out.success).toHaveBeenCalledWith(expect.stringContaining("Pipeline valid"));
    exitSpy.mockRestore();
    runSpy.mockRestore();
  });

  it("warns and exits non-zero if the file is gone after a clean session", async () => {
    mkdirSync(join(dir, "pipelines"));
    const dotPath = join(dir, "pipelines", "review.dot");
    writeFileSync(dotPath, VALID_DOT);

    const runSpy = vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async () => {
      rmSync(dotPath);
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as (code?: number | string | null | undefined) => never);
    await expect(
      pipelineRefineCommand("review", { project: dir }),
    ).rejects.toThrow("exit:1");
    expect(out.warn).toHaveBeenCalledWith(expect.stringContaining("was removed"));
    exitSpy.mockRestore();
    runSpy.mockRestore();
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
    return { id, shape: "box", agent: "noop", prompt: "noop", ...extra } as Node;
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
      a [shape=box, agent="noop", prompt="noop"]
      b [shape=box, agent="noop", prompt="noop"]
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
      a [shape=box, agent="noop", prompt="noop"]
      b [shape=box, agent="noop", prompt="noop"]
      recovery [shape=box, agent="ok", prompt="noop"]
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
      a [shape=box, agent="noop", prompt="noop"]
      c [shape=box, agent="noop", prompt="noop"]
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
      a [shape=box, agent="noop", prompt="noop"]
      b [shape=box, agent="noop", prompt="noop"]
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
      a [shape=box, agent="noop", prompt="noop"]
      b [shape=box, agent="noop", prompt="noop"]
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-refine-traces-"));
    tracesRoot = mkdtempSync(join(tmpdir(), "ralph-traces-"));
    mkdirSync(join(dir, "pipelines"));
    writeFileSync(join(dir, "pipelines", "review.dot"), VALID_DOT);
    runSpy = vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async () => {});
  });
  afterEach(() => {
    runSpy?.mockRestore();
    rmSync(dir, { recursive: true });
    rmSync(tracesRoot, { recursive: true });
  });

  function captureTraceDigest(): string {
    const calls = (runSpy as unknown as { mock: { calls: Array<[string, { variables?: Record<string, string> }]> } }).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[0][1]?.variables?.trace_digest ?? "";
  }

  it("includes trace digests in trace_digest when traces exist", async () => {
    seedTrace("run-1", "review");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    const digest = captureTraceDigest();
    expect(digest).toContain("Recent run traces for review:");
    expect(digest).toContain("run-1");
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
    const digest = captureTraceDigest();
    // 3 newest must appear
    expect(digest).toContain("run-new-2");
    expect(digest).toContain("run-new-1");
    expect(digest).toContain("run-mid");
    // 2 oldest must NOT appear
    expect(digest).not.toContain("run-old-1");
    expect(digest).not.toContain("run-old-2");
  });

  it("trace_digest is empty when no traces exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    expect(captureTraceDigest()).toBe("");
  });

  it("honors --no-traces option", async () => {
    seedTrace("run-1", "review");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot, traces: false }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    expect(captureTraceDigest()).toBe("");
  });

  it("filters traces by pipelineName (does not leak other pipelines)", async () => {
    seedTrace("run-deploy", "deploy");
    seedTrace("run-review", "review");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(
      pipelineRefineCommand("review", { project: dir, tracesRoot }),
    ).rejects.toThrow("exit");
    exitSpy.mockRestore();
    const digest = captureTraceDigest();
    expect(digest).toContain("run-review");
    expect(digest).not.toContain("run-deploy");
  });
});
