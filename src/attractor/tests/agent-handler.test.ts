import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";
import type { Node, PipelineContext } from "../types.js";
import { readFileSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const baseCtx = (): PipelineContext => ({ values: {} });

describe("AgentHandler", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();
  const mockAgentKill = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeNode(overrides: Partial<Node> = {}): Node {
    return {
      id: "work",
      shape: "box",
      label: "Do work",
      agent: "implement",
      ...overrides,
    } as Node;
  }

  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });
  }

  const baseConfig = {
    name: "implement",
    description: "Autonomous code implementation",
    model: "opus",
    prompt: "Do things",
    tools: [] as string[],
    mcp: [] as any[],
    permissionMode: "dangerouslySkipPermissions",
  };

  it("resolves agent by name and calls run", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s1", stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode(),
      baseCtx(),
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["agent.sessionId"]).toBe("s1");
    expect(outcome.contextUpdates?.["agent.iterations"]).toBe("1");
    expect(outcome.contextUpdates?.["agent.success"]).toBe("true");
  });

  it("returns fail outcome on non-zero exit", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 1, sessionId: null, stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode(),
      baseCtx(),
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("exited with code 1");
    expect(outcome.contextUpdates?.["agent.success"]).toBe("false");
  });

  it("loops when node has maxIterations", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s1", stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 3 }),
      baseCtx(),
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(mockAgentRun).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["agent.iterations"]).toBe("3");
  });

  it("does not fail on non-zero exit during multi-iteration loop", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun
      .mockResolvedValueOnce({ exitCode: 0, sessionId: "s1", stdout: null })
      .mockResolvedValueOnce({ exitCode: 1, sessionId: null, stdout: null })
      .mockResolvedValueOnce({ exitCode: 0, sessionId: "s2", stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 3 }),
      baseCtx(),
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(outcome.status).toBe("success");
    expect(mockAgentRun).toHaveBeenCalledTimes(3);
  });

  it("falls back to 'implement' agent when node has no agent attribute", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      { id: "work", shape: "box" } as Node,
      baseCtx(),
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(outcome.status).toBe("success");
    expect(mockResolve).toHaveBeenCalledWith("implement");
  });

  it("returns fail when agent resolution fails", async () => {
    mockResolve.mockImplementation(() => { throw new Error("Unknown agent: \"nonexistent\""); });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ agent: "nonexistent" }),
      baseCtx(),
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("Failed to resolve agent");
  });

  it("passes pipeline context values as variables", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = makeHandler();
    const ctx: PipelineContext = { values: { "$goal": "Ship it", "custom.key": "value" } };
    await handler.execute(
      makeNode(),
      ctx,
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(mockAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/project",
        variables: { "$goal": "Ship it", "custom.key": "value" },
      }),
    );
  });

  it("prepends pipeline context preamble to prompt.md and delivers to agent", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    try {
      const ctx: PipelineContext = { values: { "meditate.sessionId": "abc", "meditate.illuminations": "3" } };
      await handler.execute(
        makeNode({ prompt: "Build the feature" }),
        ctx,
        { logsRoot: logsDir, cwd: "/tmp/project", signal: undefined, outgoingLabels: [], completedNodes: ["start", "meditate"], nodeRetries: {} },
      );

      // Verify prompt.md on disk
      const writtenPrompt = readFileSync(join(logsDir, "work", "prompt.md"), "utf8");
      expect(writtenPrompt).toContain("Pipeline Context");
      expect(writtenPrompt).toContain("meditate.sessionId: abc");
      expect(writtenPrompt).toContain("Build the feature");

      // Verify preamble is delivered to Agent via config.prompt override
      expect(capturedConfig.prompt).toContain("Pipeline Context");
      expect(capturedConfig.prompt).toContain("start, meditate");
      expect(capturedConfig.prompt).toContain("Build the feature");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("includes completedNodes from meta in preamble", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    try {
      await handler.execute(
        makeNode({ prompt: "Next step" }),
        baseCtx(),
        { logsRoot: logsDir, cwd: "/tmp/project", signal: undefined, outgoingLabels: [], completedNodes: ["start", "analyze", "review"], nodeRetries: {} },
      );

      expect(capturedConfig.prompt).toContain("start, analyze, review");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("passes meta.onStdout to agent.run()", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = makeHandler();
    const onStdout = async (_s: NodeJS.ReadableStream) => {};
    await handler.execute(
      makeNode(),
      baseCtx(),
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {}, onStdout },
    );

    expect(mockAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ onStdout }),
    );
  });

  it("passes interactive:true to agent.run() when node.interactive is truthy", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = makeHandler();
    await handler.execute(
      makeNode({ interactive: "true" } as any),
      baseCtx(),
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
    );

    expect(mockAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ interactive: true }),
    );
    // interactive nodes should NOT pass onStdout
    expect(mockAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ onStdout: undefined }),
    );
  });

  it("stops iteration when signal is aborted", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    const ac = new AbortController();
    mockAgentRun.mockImplementation(async () => {
      ac.abort();
      return { exitCode: 0, sessionId: null, stdout: null };
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: ac.signal, outgoingLabels: [] },
    );

    // Should stop after first iteration since signal was aborted
    expect(mockAgentRun).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("success");
  });
});
