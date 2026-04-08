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
