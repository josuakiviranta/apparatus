import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runPipeline, type EngineOptions } from "../core/engine.js";
import { parseDot } from "../core/graph.js";
import type { PipelineTracer } from "../tracer/pipeline-tracer.js";
import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
import { QueueInterviewer } from "../interviewer/queue.js";
import { UndefinedVariableError } from "../transforms/variable-expansion.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Mock the agent modules so AgentHandler works without real agent files
const mockAgentRun = vi.fn().mockResolvedValue({ exitCode: 0, sessionId: "s1", stdout: null });

vi.mock("../../cli/lib/agent-registry.js", () => ({
  resolveAgent: vi.fn(() => ({
    name: "implement",
    description: "test",
    model: "sonnet",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "Do the work",
  })),
}));

vi.mock("../../cli/lib/agent.js", () => ({
  Agent: vi.fn().mockImplementation(() => ({
    run: mockAgentRun,
    kill: vi.fn(),
    config: {},
    buildArgs: vi.fn(() => []),
    expandPrompt: vi.fn((_v: Record<string, unknown>) => ""),
    writeMcpConfig: vi.fn(() => null),
    cleanupMcpConfig: vi.fn(),
  })),
  validateAgentConfig: vi.fn((c: unknown) => c),
}));

function makeOpts(logsRoot: string, overrides: Partial<EngineOptions> = {}): EngineOptions {
  return {
    logsRoot,
    cwd: "/proj",
    interviewer: new AutoApproveInterviewer(),
    ...overrides,
  };
}

describe("runPipeline", () => {
  let dir: string;
  beforeEach(() => {
    mockAgentRun.mockReset();
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s1", stdout: null });
    dir = mkdtempSync(join(tmpdir(), "ralph-engine-test-"));
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("runs a minimal pipeline to completion", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("start");
    expect(result.completedNodes).toContain("done");
  });

  it("executes a codergen node via AgentHandler", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, prompt="Do the work"]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    await runPipeline(parseDot(dot), makeOpts(dir));
    expect(mockAgentRun).toHaveBeenCalledTimes(1);
  });

  it("selects edge by condition match", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      done  [shape=Msquare]
      start -> work -> done [condition="outcome=success"]
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
  });

  it("retries node up to maxRetries then fails pipeline", async () => {
    mockAgentRun.mockResolvedValue({ exitCode: 1, sessionId: null, stdout: null });
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, max_retries=2]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("fail");
    expect(mockAgentRun).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("waits at human gate and routes by label", async () => {
    const interviewer = new QueueInterviewer(["Yes"]);
    const dot = `digraph g {
      start  [shape=Mdiamond]
      gate   [shape=hexagon, label="Proceed?"]
      impl   [shape=box]
      done   [shape=Msquare]
      start -> gate
      gate  -> impl [label="Yes"]
      gate  -> done [label="No"]
      impl  -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir, { interviewer }));
    expect(result.completedNodes).toContain("impl");
  });

  it("resumes from checkpoint", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    const checkpoint = {
      timestamp: new Date().toISOString(),
      currentNode: "work",
      completedNodes: ["start"],
      nodeRetries: {},
      context: {},
    };
    const { writeFile } = await import("fs/promises");
    await writeFile(join(dir, "checkpoint.json"), JSON.stringify(checkpoint), "utf8");
    const result = await runPipeline(parseDot(dot), makeOpts(dir, { resume: true }));
    expect(result.status).toBe("success");
    expect(mockAgentRun).toHaveBeenCalledTimes(1);
  });

  it("fails when goal gate node was not completed before exit", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      gate  [shape=box, goal_gate=true]
      done  [shape=Msquare]
      start -> done
      start -> gate
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("fail");
    expect(result.failureReason).toContain("Goal gate");
    expect(result.failureReason).toContain("gate");
  });

  it("succeeds when goal gate node was completed on path", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      gate  [shape=box, goal_gate=true]
      done  [shape=Msquare]
      start -> gate -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("gate");
  });

  it("cascades to retry_target when goal gate unsatisfied", async () => {
    const dot = `digraph g {
      start  [shape=Mdiamond]
      gate   [shape=box, goal_gate=true, retry_target=gate]
      done   [shape=Msquare]
      start -> done
      start -> gate
      gate -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("gate");
    expect(mockAgentRun).toHaveBeenCalledTimes(1);
  });

  it("succeeds when all goal gates on path are completed", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      g1    [shape=box, goal_gate=true]
      g2    [shape=box, goal_gate=true]
      done  [shape=Msquare]
      start -> g1 -> g2 -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("g1");
    expect(result.completedNodes).toContain("g2");
  });

  it("returns fail when no start node", async () => {
    const dot = `digraph g {
      done [shape=Msquare]
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("fail");
    expect(result.failureReason).toContain("start");
  });

  it("deduplicates completedNodes when node is visited multiple times", async () => {
    // A node visited via retry should appear only once in completedNodes
    let callCount = 0;
    mockAgentRun.mockImplementation(async () => {
      callCount++;
      // First call fails, triggering retry; second call succeeds
      return { exitCode: callCount === 1 ? 1 : 0, sessionId: null, stdout: null };
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, max_retries=1]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
    // work should appear exactly once despite being visited twice
    const workCount = result.completedNodes.filter(n => n === "work").length;
    expect(workCount).toBe(1);
  });

  it("preserves context across loop_restart", async () => {
    // First iteration: agent succeeds with context updates
    // The loop_restart edge should preserve accumulated context
    let callCount = 0;
    mockAgentRun.mockImplementation(async () => {
      callCount++;
      return { exitCode: 0, sessionId: `s${callCount}`, stdout: null };
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      check [shape=diamond]
      done  [shape=Msquare]
      start -> work -> check
      check -> done [condition="context.loop.iteration=1"]
      check -> start [loop_restart=true]
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
    // Context should have loop.iteration preserved
    expect(result.context["loop.iteration"]).toBe("1");
    // Agent should have been called twice (once per loop iteration)
    expect(mockAgentRun).toHaveBeenCalledTimes(2);
  });

  it("returns fail when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir, { signal: ac.signal }));
    expect(result.status).toBe("fail");
    expect(result.failureReason).toContain("Aborted");
  });

  it("saves checkpoint with nextEdge.to for normal advance", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    await runPipeline(parseDot(dot), makeOpts(dir));
    // Read the final checkpoint — should point to the exit node
    const { readFile } = await import("fs/promises");
    const cp = JSON.parse(await readFile(join(dir, "checkpoint.json"), "utf8"));
    expect(cp.currentNode).toBe("done");
    expect(cp.completedNodes).toContain("start");
    expect(cp.completedNodes).toContain("work");
    expect(cp.completedNodes).toContain("done");
  });

  it("saves correct checkpoint state after loop_restart", async () => {
    let callCount = 0;
    mockAgentRun.mockImplementation(async () => {
      callCount++;
      return { exitCode: 0, sessionId: `s${callCount}`, stdout: null };
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      check [shape=diamond]
      done  [shape=Msquare]
      start -> work -> check
      check -> done [condition="context.loop.iteration=1"]
      check -> start [loop_restart=true]
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
    // Final checkpoint should point to exit node
    const { readFile } = await import("fs/promises");
    const cp = JSON.parse(await readFile(join(dir, "checkpoint.json"), "utf8"));
    expect(cp.currentNode).toBe("done");
  });

  it("calls onNodeStart for each node including exit node", async () => {
    const started: string[] = [];
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    await runPipeline(parseDot(dot), makeOpts(dir, {
      onNodeStart: (node) => { started.push(node.id); },
    }));
    expect(started).toContain("start");
    expect(started).toContain("work");
    expect(started).toContain("done");
  });

  it("passes onStdout in meta to handlers without error", async () => {
    const onStdout = async (_s: NodeJS.ReadableStream) => {};
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    // Verifies the engine accepts onStdout and threads it to handlers via meta.
    // The agent-handler test suite verifies actual forwarding to agent.run().
    const result = await runPipeline(parseDot(dot), makeOpts(dir, { onStdout }));
    expect(result.status).toBe("success");
  });

  it("warns when --resume finds no checkpoint", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dot = `digraph g {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`;
    await runPipeline(parseDot(dot), makeOpts(dir, { resume: true }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no checkpoint found"));
    warnSpy.mockRestore();
  });

  it("fires onNodeEnd for agent nodes with terminal outcomes", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, prompt="Do the work"]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    const calls: Array<{ id: string; status: string }> = [];
    await runPipeline(parseDot(dot), makeOpts(dir, {
      onNodeEnd: (node, outcome) => {
        calls.push({ id: node.id, status: outcome.status });
      },
    }));
    // "work" should fire onNodeEnd; start/done are exit/entry markers
    expect(calls.some((c) => c.id === "work")).toBe(true);
    expect(calls.find((c) => c.id === "work")?.status).toBe("success");
  });

  it("does NOT fire onNodeEnd for in-flight retries", async () => {
    // First call fails, second succeeds — with maxRetries=1 the first failure
    // is retried and should NOT emit onNodeEnd.
    mockAgentRun
      .mockResolvedValueOnce({ exitCode: 1, sessionId: "s1", stdout: null })
      .mockResolvedValueOnce({ exitCode: 0, sessionId: "s2", stdout: null });
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, prompt="Do the work", maxRetries="1"]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    const calls: Array<{ id: string; status: string }> = [];
    await runPipeline(parseDot(dot), makeOpts(dir, {
      onNodeEnd: (node, outcome) => {
        calls.push({ id: node.id, status: outcome.status });
      },
    }));
    // onNodeEnd should fire exactly once for "work" (the terminal success),
    // NOT twice (once for the retry failure + once for success).
    const workCalls = calls.filter((c) => c.id === "work");
    expect(workCalls).toHaveLength(1);
    expect(workCalls[0].status).toBe("success");
  });

  it("halts pipeline and returns fail on UndefinedVariableError", async () => {
    mockAgentRun.mockRejectedValueOnce(new UndefinedVariableError("missing_var"));
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("fail");
    expect(result.failureReason).toContain("missing_var");
    expect(result.failureReason).toContain("work");
  });

  it("includes path taken in UndefinedVariableError failure reason", async () => {
    mockAgentRun
      .mockResolvedValueOnce({ exitCode: 0, sessionId: "s1", stdout: null })
      .mockRejectedValueOnce(new UndefinedVariableError("refinements"));
    const dot = `digraph g {
      start [shape=Mdiamond]
      step1 [shape=box]
      step2 [shape=box]
      done  [shape=Msquare]
      start -> step1 -> step2 -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("fail");
    expect(result.failureReason).toContain("step2");
    expect(result.failureReason).toContain("refinements");
    expect(result.completedNodes).toContain("step1");
  });

  it("generates a unique run_id in pipeline context", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.context["run_id"]).toBeDefined();
    expect(typeof result.context["run_id"]).toBe("string");
    expect((result.context["run_id"] as string).length).toBeGreaterThan(0);
  });

  it("generates different run_ids for successive runs", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    const r1 = await runPipeline(graph, makeOpts(dir));
    const r2 = await runPipeline(graph, makeOpts(dir));
    expect(r1.context["run_id"]).not.toBe(r2.context["run_id"]);
  });

  it("does not dispatch further nodes after UndefinedVariableError", async () => {
    mockAgentRun.mockRejectedValueOnce(new UndefinedVariableError("missing_var"));
    const dot = `digraph g {
      start [shape=Mdiamond]
      work1 [shape=box]
      work2 [shape=box]
      done  [shape=Msquare]
      start -> work1 -> work2 -> done
    }`;
    await runPipeline(parseDot(dot), makeOpts(dir));
    expect(mockAgentRun).toHaveBeenCalledTimes(1);
  });

  it("calls traceWriter.onNodeStart and onNodeEnd for each node", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, prompt="do work"]
      done  [shape=Msquare]
      start -> work
      work  -> done
    }`;
    const graph = parseDot(dot);

    const tracer: PipelineTracer = {
      onPipelineStart: vi.fn(),
      onNodeStart: vi.fn(),
      onNodeEnd: vi.fn(),
      onPipelineEnd: vi.fn(),
    };

    mockAgentRun.mockResolvedValueOnce({ exitCode: 0, sessionId: "s1", stdout: null });
    await runPipeline(graph, makeOpts(dir, { traceWriter: tracer }));

    expect(tracer.onPipelineStart).toHaveBeenCalledOnce();
    expect(tracer.onPipelineEnd).toHaveBeenCalledOnce();

    // onNodeStart called for start, work, done (3 nodes)
    expect(tracer.onNodeStart).toHaveBeenCalledTimes(3);
    // All calls include nodeReceiveId with pattern <nodeId>-<4hexchars>
    const startCalls = (tracer.onNodeStart as ReturnType<typeof vi.fn>).mock.calls;
    for (const [meta] of startCalls) {
      expect(meta.nodeReceiveId).toMatch(/^.+-[0-9a-f]{4}$/);
      expect(meta.node).toBeDefined();
      expect(meta.ctx).toBeDefined();
    }
  });

  it("passes nodeReceiveId to onNodeStart callback", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, prompt="do work"]
      done  [shape=Msquare]
      start -> work
      work  -> done
    }`;
    const graph = parseDot(dot);
    const nodeStartMeta: Array<{ nodeReceiveId: string }> = [];

    mockAgentRun.mockResolvedValueOnce({ exitCode: 0, sessionId: "s1", stdout: null });
    await runPipeline(graph, makeOpts(dir, {
      onNodeStart: (_node: unknown, meta: { nodeReceiveId: string }) => { nodeStartMeta.push(meta); },
    }));

    expect(nodeStartMeta).toHaveLength(3);
    for (const meta of nodeStartMeta) {
      expect(meta.nodeReceiveId).toMatch(/^.+-[0-9a-f]{4}$/);
    }
  });
});
