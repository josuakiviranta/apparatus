import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runPipeline, type EngineOptions } from "../core/engine.js";
import { parseDot } from "../core/graph.js";
import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
import { QueueInterviewer } from "../interviewer/queue.js";
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
    expandPrompt: vi.fn((v: Record<string, string>) => ""),
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

  it("calls onNodeStart for each node (exit node skipped — handled before handler dispatch)", async () => {
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
    // Exit node is processed before handler dispatch, so onNodeStart is not called for it
    expect(started).not.toContain("done");
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
});
