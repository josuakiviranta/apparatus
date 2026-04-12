import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";
import type { Node, PipelineContext } from "../types.js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const baseCtx = (): PipelineContext => ({ values: {} });

function makeContext(overrides: Partial<HandlerExecutionContext> = {}): HandlerExecutionContext {
  return { logsRoot: "/tmp/logs", cwd: "/tmp/project", dotDir: "/tmp/project", outgoingLabels: [], completedNodes: [], nodeRetries: {}, ...overrides };
}

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
      makeContext(),
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
      makeContext(),
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
      makeContext(),
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
      makeContext(),
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
      makeContext(),
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
      makeContext(),
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
      makeContext(),
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
        makeContext({ logsRoot: logsDir, completedNodes: ["start", "meditate"] }),
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
        makeContext({ logsRoot: logsDir, completedNodes: ["start", "analyze", "review"] }),
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
      makeContext({ onStdout }),
    );

    expect(mockAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ onStdout }),
    );
  });

  it("interactive nodes do not go through legacy agent.run() path", async () => {
    // Interactive nodes now use the interactive branch (runInteractive + ChatUI).
    // This test verifies agent.run() is NOT called for interactive nodes.
    // Full interactive branch coverage is in agent-handler-interactive.test.ts.
    mockResolve.mockReturnValue({ ...baseConfig });
    let resolveExited: (v: any) => void;
    const exitedPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
      resolveExited = res;
    });
    const mockRunInteractive = vi.fn().mockReturnValue({
      sessionId: "s1",
      events: (async function* () { /* empty */ })(),
      submit: async () => {},
      end: async () => { resolveExited!({ code: 0, signal: null }); },
      kill: async () => { resolveExited!({ code: null, signal: "SIGTERM" }); },
      exited: exitedPromise,
    });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {}, runInteractive: mockRunInteractive } as any),
      render: (element: any) => {
        const { session, child, onExit } = element.props;
        session.exitReason = "user_end";
        setTimeout(async () => {
          await child.end();
          onExit("user_end");
        }, 5);
        return { unmount: () => {}, waitUntilExit: async () => {} };
      },
    });
    await handler.execute(
      makeNode({ interactive: "true" } as any),
      baseCtx(),
      makeContext(),
    );

    expect(mockAgentRun).not.toHaveBeenCalled();
    expect(mockRunInteractive).toHaveBeenCalled();
  });

  it("expands $variable references in prompt from pipeline context at runtime", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    try {
      const ctx: PipelineContext = { values: { "illumination_path": "/meditations/foo.md", "summary": "a bug" } };
      await handler.execute(
        makeNode({ prompt: "Check $illumination_path which has $summary" }),
        ctx,
        makeContext({ logsRoot: logsDir }),
      );

      expect(capturedConfig.prompt).toContain("/meditations/foo.md");
      expect(capturedConfig.prompt).toContain("a bug");
      expect(capturedConfig.prompt).not.toContain("$illumination_path");
      expect(capturedConfig.prompt).not.toContain("$summary");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("reads jsonSchemaFile and passes schema to agent config", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    const schemaDir = join(logsDir, "schemas");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, "test.json"), schema);

    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: JSON.stringify([{ type: "result", result: "", structured_output: { verdict: "true" } }]) });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    try {
      await handler.execute(
        makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      expect(capturedConfig.jsonSchema).toBe(schema);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("merges parsed JSON output into contextUpdates", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" }, path: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    const schemaDir = join(logsDir, "schemas");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, "test.json"), schema);

    mockResolve.mockReturnValue({ ...baseConfig });
    const jsonArrayOutput = JSON.stringify([
      { type: "result", result: "", structured_output: { verdict: "true", path: "/foo.md" }, session_id: "s1" },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s1", stdout: null, output: jsonArrayOutput });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      const outcome = await handler.execute(
        makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      expect(outcome.status).toBe("success");
      expect(outcome.contextUpdates?.["verdict"]).toBe("true");
      expect(outcome.contextUpdates?.["path"]).toBe("/foo.md");
      expect(outcome.contextUpdates?.["agent.sessionId"]).toBe("s1");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("unwraps Claude CLI --output-format json array wrapper before parsing", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" }, path: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    const schemaDir = join(logsDir, "schemas");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, "test.json"), schema);

    mockResolve.mockReturnValue({ ...baseConfig });
    // Real Claude CLI --output-format json: single-line JSON array of events
    const jsonArrayOutput = JSON.stringify([
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "assistant", message: { content: [{ type: "text", text: "thinking..." }] } },
      { type: "result", subtype: "success", result: "", structured_output: { verdict: "true", path: "/foo.md" }, session_id: "s1" },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s1", stdout: null, output: jsonArrayOutput });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      const outcome = await handler.execute(
        makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      expect(outcome.status).toBe("success");
      expect(outcome.contextUpdates?.["verdict"]).toBe("true");
      expect(outcome.contextUpdates?.["path"]).toBe("/foo.md");
      // Should NOT have numeric keys from iterating the array
      expect(outcome.contextUpdates?.["0"]).toBeUndefined();
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("extracts structured_output from result event (real CLI format)", async () => {
    const schema = JSON.stringify({ type: "object", properties: { preferred_label: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    const schemaDir = join(logsDir, "schemas");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, "test.json"), schema);

    mockResolve.mockReturnValue({ ...baseConfig });
    // Real CLI: result="" with structured_output containing the data
    const wrapper = JSON.stringify([
      { type: "system", subtype: "init", session_id: "s2" },
      { type: "result", subtype: "success", result: "", structured_output: { preferred_label: "false" }, session_id: "s2" },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s2", stdout: null, output: wrapper });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      const outcome = await handler.execute(
        makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      expect(outcome.status).toBe("success");
      expect(outcome.preferredLabel).toBe("false");
      expect(outcome.contextUpdates?.["0"]).toBeUndefined();
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("sets preferredLabel from parsed JSON preferred_label key", async () => {
    const schema = JSON.stringify({ type: "object", properties: { preferred_label: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    const schemaDir = join(logsDir, "schemas");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, "test.json"), schema);

    mockResolve.mockReturnValue({ ...baseConfig });
    const jsonArrayOutput = JSON.stringify([
      { type: "result", result: "", structured_output: { preferred_label: "false" } },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: jsonArrayOutput });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      const outcome = await handler.execute(
        makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      expect(outcome.preferredLabel).toBe("false");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("returns fail when structured output cannot be parsed", async () => {
    const schema = JSON.stringify({ type: "object" });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    const schemaDir = join(logsDir, "schemas");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, "test.json"), schema);

    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: "not valid json" });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      const outcome = await handler.execute(
        makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      expect(outcome.status).toBe("fail");
      expect(outcome.failureReason).toContain("no {type:\"result\"} event found");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
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
      makeContext({ signal: ac.signal }),
    );

    // Should stop after first iteration since signal was aborted
    expect(mockAgentRun).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("success");
  });
});
