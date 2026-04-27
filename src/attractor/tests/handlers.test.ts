import { describe, it, expect, vi } from "vitest";
import type { HandlerExecutionContext } from "../handlers/registry.js";
import { ConditionalHandler } from "../handlers/conditional.js";
import { WaitHumanHandler } from "../handlers/wait-human.js";
import { ToolHandler } from "../handlers/tool.js";
import { StartHandler, ExitHandler } from "../handlers/start-exit.js";
import { ParallelHandler, FanInHandler } from "../handlers/parallel.js";
import { ManagerLoopHandler } from "../handlers/manager-loop.js";
import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
import { QueueInterviewer } from "../interviewer/queue.js";
import type { Interviewer } from "../interviewer/index.js";
import type { Node, PipelineContext } from "../types.js";

const baseCtx = (): PipelineContext => ({ values: {} });

function makeContext(overrides: Partial<HandlerExecutionContext> = {}): HandlerExecutionContext {
  return { logsRoot: "/tmp", cwd: "/tmp", dotDir: "/tmp", outgoingLabels: [], completedNodes: [], nodeRetries: {}, ...overrides };
}

describe("ConditionalHandler", () => {
  it("returns success immediately", async () => {
    const h = new ConditionalHandler();
    const node: Node = { id: "c", shape: "diamond" };
    const outcome = await h.execute(node, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
  });
});

describe("StartHandler / ExitHandler", () => {
  it("start returns success immediately", async () => {
    const h = new StartHandler();
    const outcome = await h.execute({ id: "start" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
  });

  it("exit returns success immediately", async () => {
    const h = new ExitHandler();
    const outcome = await h.execute({ id: "done" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
  });
});

describe("WaitHumanHandler", () => {
  it("presents outgoing edge labels and returns preferredLabel", async () => {
    const interviewer = new QueueInterviewer(["Yes"]);
    const h = new WaitHumanHandler(interviewer);
    const node: Node = { id: "gate", shape: "hexagon", label: "Accept?" };
    const outcome = await h.execute(node, baseCtx(), makeContext({ outgoingLabels: ["Yes", "No"] }));
    expect(outcome.status).toBe("success");
    expect(outcome.preferredLabel).toBe("Yes");
  });

  it("auto-approves with AutoApproveInterviewer", async () => {
    const h = new WaitHumanHandler(new AutoApproveInterviewer());
    const node: Node = { id: "gate", shape: "hexagon", label: "Proceed?" };
    const outcome = await h.execute(node, baseCtx(), makeContext({ outgoingLabels: ["Approve", "Reject"] }));
    expect(outcome.preferredLabel).toBe("Approve");
  });

  it("returns fail when signal is already aborted", async () => {
    const interviewer = new QueueInterviewer(["Yes"]);
    const h = new WaitHumanHandler(interviewer);
    const ac = new AbortController();
    ac.abort();
    const node: Node = { id: "gate", shape: "hexagon", label: "Accept?" };
    const outcome = await h.execute(node, baseCtx(), makeContext({ outgoingLabels: ["Yes", "No"], signal: ac.signal }));
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("Aborted");
  });

  it("returns fail when signal aborts during ask", async () => {
    const ac = new AbortController();
    const slowInterviewer: Interviewer = {
      ask: () => new Promise(() => { /* never resolves */ }),
    };
    const h = new WaitHumanHandler(slowInterviewer);
    const node: Node = { id: "gate", shape: "hexagon", label: "Accept?" };
    const promise = h.execute(node, baseCtx(), makeContext({ outgoingLabels: ["Yes", "No"], signal: ac.signal }));
    ac.abort();
    const outcome = await promise;
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("Aborted");
  });

  it("succeeds normally when signal is provided but not aborted", async () => {
    const interviewer = new QueueInterviewer(["Yes"]);
    const h = new WaitHumanHandler(interviewer);
    const ac = new AbortController();
    const node: Node = { id: "gate", shape: "hexagon", label: "Accept?" };
    const outcome = await h.execute(node, baseCtx(), makeContext({ outgoingLabels: ["Yes", "No"], signal: ac.signal }));
    expect(outcome.status).toBe("success");
    expect(outcome.preferredLabel).toBe("Yes");
  });
});

describe("ToolHandler", () => {
  it("returns success when command exits 0", async () => {
    const h = new ToolHandler();
    const node: Node = { id: "t", shape: "parallelogram", toolCommand: "echo hello" };
    const outcome = await h.execute(node, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("hello");
  });

  it("returns fail when command exits non-zero", async () => {
    const h = new ToolHandler();
    const node: Node = { id: "t", shape: "parallelogram", toolCommand: "exit 1" };
    const outcome = await h.execute(node, baseCtx(), makeContext());
    expect(outcome.status).toBe("fail");
  });

  // "no toolCommand" check is now performed at validate-time by zod
  // (ToolNodeSchema refine: toolCommand || scriptFile required).
  // The runtime guard was removed in Chunk 4 of the validator trust upgrade.
});

describe("ParallelHandler", () => {
  it("returns success and stores parallel.results in contextUpdates", async () => {
    const h = new ParallelHandler();
    const node: Node = { id: "fan", shape: "component" };
    const outcome = await h.execute(node, baseCtx(), makeContext({
      branchOutcomes: { branch_a: { status: "success" }, branch_b: { status: "success" } },
    }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["parallel.results"]).toBeDefined();
  });

  it("serializes branch outcomes as JSON array", async () => {
    const h = new ParallelHandler();
    const node: Node = { id: "fan", shape: "component" };
    const outcome = await h.execute(node, baseCtx(), makeContext({
      branchOutcomes: { a: { status: "success" }, b: { status: "fail" } },
    }));
    const parsed = JSON.parse(outcome.contextUpdates!["parallel.results"] as string);
    expect(parsed).toHaveLength(2);
  });

  it("handles empty branchOutcomes gracefully", async () => {
    const h = new ParallelHandler();
    const outcome = await h.execute({ id: "fan", shape: "component" }, baseCtx(), makeContext({ branchOutcomes: {} }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["parallel.results"]).toBe("[]");
  });

  it("handles undefined branchOutcomes (falls back to empty)", async () => {
    const h = new ParallelHandler();
    const outcome = await h.execute({ id: "fan", shape: "component" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["parallel.results"]).toBe("[]");
  });
});

describe("FanInHandler", () => {
  it("aggregates all-success to success", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": JSON.stringify([{ status: "success" }, { status: "success" }]) } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, makeContext());
    expect(outcome.status).toBe("success");
  });

  it("aggregates mixed to partial_success", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": JSON.stringify([{ status: "success" }, { status: "fail" }]) } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, makeContext());
    expect(outcome.status).toBe("partial_success");
  });

  it("aggregates all-fail to fail", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": JSON.stringify([{ status: "fail" }, { status: "fail" }]) } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, makeContext());
    expect(outcome.status).toBe("fail");
  });

  it("returns success for empty results (vacuous truth)", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": "[]" } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, makeContext());
    expect(outcome.status).toBe("success");
  });

  it("returns success when parallel.results is missing", async () => {
    const h = new FanInHandler();
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
  });
});

describe("ManagerLoopHandler", () => {
  it("returns success when child completes", async () => {
    const fakeChild = vi.fn()
      .mockResolvedValueOnce({ status: "running", currentNode: "work" })
      .mockResolvedValueOnce({ status: "success" });
    const h = new ManagerLoopHandler(fakeChild, { pollIntervalMs: 0, maxCycles: 10 });
    const node: Node = { id: "mgr", shape: "house" };
    const outcome = await h.execute(node, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates).toEqual({ "stack.child.status": "success", "stack.child.outcome": "success" });
  });

  it("returns fail when child fails", async () => {
    const fakeChild = vi.fn().mockResolvedValueOnce({ status: "fail" });
    const h = new ManagerLoopHandler(fakeChild, { pollIntervalMs: 0, maxCycles: 10 });
    const outcome = await h.execute({ id: "mgr", shape: "house" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toBe("Child pipeline failed");
    expect(outcome.contextUpdates).toEqual({ "stack.child.status": "fail", "stack.child.outcome": "fail" });
  });

  it("returns fail when max_cycles exceeded", async () => {
    const fakeChild = vi.fn().mockResolvedValue({ status: "running", currentNode: "work" });
    const h = new ManagerLoopHandler(fakeChild, { pollIntervalMs: 0, maxCycles: 3 });
    const node: Node = { id: "mgr", shape: "house" };
    const outcome = await h.execute(node, baseCtx(), makeContext());
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("max_cycles");
    expect(fakeChild).toHaveBeenCalledTimes(3);
  });

  it("returns success immediately if child succeeds on first poll", async () => {
    const fakeChild = vi.fn().mockResolvedValueOnce({ status: "success" });
    const h = new ManagerLoopHandler(fakeChild, { pollIntervalMs: 0, maxCycles: 10 });
    const outcome = await h.execute({ id: "mgr", shape: "house" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
    expect(fakeChild).toHaveBeenCalledTimes(1);
  });
});
