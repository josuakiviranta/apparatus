import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runPipeline, type EngineOptions } from "../core/engine.js";
import { parseDot } from "../core/graph.js";
import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
import { QueueInterviewer } from "../interviewer/queue.js";
import type { LoopResult } from "../../cli/lib/loop.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const fakeRunLoop = vi.fn(async (): Promise<LoopResult> => ({
  success: true, iterations: 1, exitReason: "completed", sessionId: "s1",
}));

function makeOpts(logsRoot: string, overrides: Partial<EngineOptions> = {}): EngineOptions {
  return {
    logsRoot,
    cwd: "/proj",
    runLoop: fakeRunLoop,
    interviewer: new AutoApproveInterviewer(),
    ...overrides,
  };
}

describe("runPipeline", () => {
  let dir: string;
  beforeEach(() => {
    vi.restoreAllMocks();
    fakeRunLoop.mockImplementation(async (): Promise<LoopResult> => ({
      success: true, iterations: 1, exitReason: "completed", sessionId: "s1",
    }));
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

  it("executes a codergen node via runLoop", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, prompt="Do the work"]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    await runPipeline(parseDot(dot), makeOpts(dir));
    expect(fakeRunLoop).toHaveBeenCalledTimes(1);
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
    fakeRunLoop.mockResolvedValue({ success: false, iterations: 1, exitReason: "error", errorMessage: "boom" });
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, max_retries=2]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("fail");
    expect(fakeRunLoop).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
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
    expect(fakeRunLoop).toHaveBeenCalledTimes(1);
  });

  it("fails when goal gate node was not completed before exit", async () => {
    // Gate node is not on the path from start → done, so it won't be completed
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
    // Pipeline: start → done (skipping gate), but gate has goal_gate=true
    // At exit, gate is unsatisfied → cascade to gate via retry_target
    // Then gate → done succeeds because gate is now completed
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
    // runLoop should have been called once for the gate node
    expect(fakeRunLoop).toHaveBeenCalledTimes(1);
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
});
