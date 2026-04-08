import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerHandler, lookupHandler, clearHandlers } from "../handlers/registry.js";
import { ConditionalHandler } from "../handlers/conditional.js";
import { WaitHumanHandler } from "../handlers/wait-human.js";
import { ToolHandler } from "../handlers/tool.js";
import { CodergenHandler } from "../handlers/codergen.js";
import { StartHandler, ExitHandler } from "../handlers/start-exit.js";
import { ParallelHandler, FanInHandler } from "../handlers/parallel.js";
import { ManagerLoopHandler } from "../handlers/manager-loop.js";
import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
import { QueueInterviewer } from "../interviewer/queue.js";
import type { Node, PipelineContext } from "../types.js";

const baseCtx = (): PipelineContext => ({ values: {} });

describe("registry", () => {
  beforeEach(() => { clearHandlers(); });

  it("lookupHandler returns handler for known type", () => {
    registerHandler("conditional", new ConditionalHandler());
    const h = lookupHandler("conditional");
    expect(h).toBeDefined();
  });

  it("lookupHandler returns null for unknown type", () => {
    const h = lookupHandler("does.not.exist");
    expect(h).toBeNull();
  });
});

describe("ConditionalHandler", () => {
  it("returns success immediately", async () => {
    const h = new ConditionalHandler();
    const node: Node = { id: "c", shape: "diamond" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("success");
  });
});

describe("StartHandler / ExitHandler", () => {
  it("start returns success immediately", async () => {
    const h = new StartHandler();
    const outcome = await h.execute({ id: "start" }, baseCtx(), {});
    expect(outcome.status).toBe("success");
  });

  it("exit returns success immediately", async () => {
    const h = new ExitHandler();
    const outcome = await h.execute({ id: "done" }, baseCtx(), {});
    expect(outcome.status).toBe("success");
  });
});

describe("WaitHumanHandler", () => {
  it("presents outgoing edge labels and returns preferredLabel", async () => {
    const interviewer = new QueueInterviewer(["Yes"]);
    const h = new WaitHumanHandler(interviewer);
    const node: Node = { id: "gate", shape: "hexagon", label: "Accept?" };
    const outcome = await h.execute(node, baseCtx(), { outgoingLabels: ["Yes", "No"] });
    expect(outcome.status).toBe("success");
    expect(outcome.preferredLabel).toBe("Yes");
  });

  it("auto-approves with AutoApproveInterviewer", async () => {
    const h = new WaitHumanHandler(new AutoApproveInterviewer());
    const node: Node = { id: "gate", shape: "hexagon" };
    const outcome = await h.execute(node, baseCtx(), { outgoingLabels: ["Approve", "Reject"] });
    expect(outcome.preferredLabel).toBe("Approve");
  });
});

describe("ToolHandler", () => {
  it("returns success when command exits 0", async () => {
    const h = new ToolHandler();
    const node: Node = { id: "t", shape: "parallelogram", toolCommand: "echo hello" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("hello");
  });

  it("returns fail when command exits non-zero", async () => {
    const h = new ToolHandler();
    const node: Node = { id: "t", shape: "parallelogram", toolCommand: "exit 1" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("fail");
  });

  it("returns fail when no toolCommand", async () => {
    const h = new ToolHandler();
    const node: Node = { id: "t", shape: "parallelogram" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("tool_command");
  });
});

describe("CodergenHandler", () => {
  it("returns fail if runLoop throws", async () => {
    const fakeRunLoop = vi.fn().mockRejectedValue(new Error("claude not found"));
    const h = new CodergenHandler(fakeRunLoop);
    const node = { id: "work", shape: "box", prompt: "Do the work" };
    const outcome = await h.execute(node, baseCtx(), { logsRoot: "/tmp", cwd: "/proj" });
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("claude not found");
  });

  it("returns success when runLoop returns success=true", async () => {
    const fakeRunLoop = vi.fn().mockResolvedValue({
      success: true, iterations: 1, exitReason: "completed", sessionId: "s1"
    });
    const h = new CodergenHandler(fakeRunLoop);
    const node = { id: "work", shape: "box", prompt: "Do the work" };
    const outcome = await h.execute(node, baseCtx(), { logsRoot: "/tmp", cwd: "/proj" });
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["implement.sessionId"]).toBe("s1");
  });

  it("passes llmModel from node to runLoop as model", async () => {
    const fakeRunLoop = vi.fn().mockResolvedValue({
      success: true, iterations: 1, exitReason: "completed"
    });
    const h = new CodergenHandler(fakeRunLoop);
    const node = { id: "work", shape: "box", prompt: "Do work", llmModel: "claude-haiku-4-5-20251001" };
    await h.execute(node, baseCtx(), { logsRoot: "/tmp", cwd: "/proj" });
    expect(fakeRunLoop).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5-20251001" })
    );
  });

  it("defaults model to opus when llmModel is not set", async () => {
    const fakeRunLoop = vi.fn().mockResolvedValue({
      success: true, iterations: 1, exitReason: "completed"
    });
    const h = new CodergenHandler(fakeRunLoop);
    const node = { id: "work", shape: "box", prompt: "Do work" };
    await h.execute(node, baseCtx(), { logsRoot: "/tmp", cwd: "/proj" });
    expect(fakeRunLoop).toHaveBeenCalledWith(
      expect.objectContaining({ model: "opus" })
    );
  });
});

describe("ParallelHandler", () => {
  it("returns success and stores parallel.results in contextUpdates", async () => {
    const h = new ParallelHandler();
    const node: Node = { id: "fan", shape: "component" };
    const outcome = await h.execute(node, baseCtx(), {
      branchOutcomes: { branch_a: { status: "success" }, branch_b: { status: "success" } },
    });
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["parallel.results"]).toBeDefined();
  });
});

describe("FanInHandler", () => {
  it("aggregates all-success to success", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": JSON.stringify([{ status: "success" }, { status: "success" }]) } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, {});
    expect(outcome.status).toBe("success");
  });

  it("aggregates mixed to partial_success", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": JSON.stringify([{ status: "success" }, { status: "fail" }]) } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, {});
    expect(outcome.status).toBe("partial_success");
  });

  it("aggregates all-fail to fail", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": JSON.stringify([{ status: "fail" }, { status: "fail" }]) } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, {});
    expect(outcome.status).toBe("fail");
  });
});

describe("ManagerLoopHandler", () => {
  it("returns success when child completes", async () => {
    const fakeChild = vi.fn()
      .mockResolvedValueOnce({ status: "running", currentNode: "work" })
      .mockResolvedValueOnce({ status: "success" });
    const h = new ManagerLoopHandler(fakeChild, { pollIntervalMs: 0, maxCycles: 10 });
    const node: Node = { id: "mgr", shape: "house" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("success");
  });

  it("returns fail when max_cycles exceeded", async () => {
    const fakeChild = vi.fn().mockResolvedValue({ status: "running", currentNode: "work" });
    const h = new ManagerLoopHandler(fakeChild, { pollIntervalMs: 0, maxCycles: 3 });
    const node: Node = { id: "mgr", shape: "house" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("fail");
    expect(fakeChild).toHaveBeenCalledTimes(3);
  });
});
