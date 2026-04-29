import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";
import type { Node, PipelineContext } from "../types.js";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
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
    expect(mockResolve).toHaveBeenCalledWith(
      "implement",
      expect.objectContaining({ allowBundledFallback: false }),
    );
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
        variables: expect.objectContaining({
          "$goal": "Ship it",
          "custom.key": "value",
        }),
      }),
    );
  });

  it("auto-injects standard MCP infra variables (illumination server, project root, meta-meditations dir)", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = makeHandler();
    await handler.execute(
      makeNode(),
      baseCtx(),
      makeContext({ projectDir: "/tmp/specific-project" }),
    );

    const call = mockAgentRun.mock.calls[0][0];
    expect(call.variables.ILLUMINATION_SERVER_PATH).toMatch(/illumination-server\.(ts|js)$/);
    expect(call.variables.PROJECT_ROOT).toBe("/tmp/specific-project");
    expect(call.variables.META_MEDITATIONS_DIR).toMatch(/meditations\/stimuli$/);
  });

  it("falls back PROJECT_ROOT to cwd when projectDir is not set", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = makeHandler();
    await handler.execute(
      makeNode(),
      baseCtx(),
      makeContext({ cwd: "/tmp/cwd-project" }),
    );

    expect(mockAgentRun.mock.calls[0][0].variables.PROJECT_ROOT).toBe("/tmp/cwd-project");
  });

  it("lets caller-provided ctx values override auto-injected MCP infra vars", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = makeHandler();
    const ctx: PipelineContext = {
      values: {
        ILLUMINATION_SERVER_PATH: "/custom/server.js",
        PROJECT_ROOT: "/custom/project",
      },
    };
    await handler.execute(
      makeNode(),
      ctx,
      makeContext(),
    );

    const vars = mockAgentRun.mock.calls[0][0].variables;
    expect(vars.ILLUMINATION_SERVER_PATH).toBe("/custom/server.js");
    expect(vars.PROJECT_ROOT).toBe("/custom/project");
  });

  it("dev-mode swaps node→tsx for MCP commands so .ts servers run via tsx", async () => {
    let capturedConfig: any = null;
    mockResolve.mockReturnValue({
      ...baseConfig,
      mcp: [
        { name: "illumination", command: "node", args: ["{{ILLUMINATION_SERVER_PATH}}"] },
        { name: "other", command: "python", args: ["other.py"] },
      ],
    });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => {
        capturedConfig = config;
        return { run: mockAgentRun, kill: mockAgentKill, config } as any;
      },
    });

    await handler.execute(
      makeNode(),
      baseCtx(),
      makeContext(),
    );

    // Vitest runs without tsup's __RALPH_PROD__ define, so dev-mode is active.
    expect(capturedConfig.mcp[0].command).toBe("tsx");
    expect(capturedConfig.mcp[1].command).toBe("python"); // non-node commands untouched
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

  it("prepends agent rubric body before node task in prompt.md", async () => {
    const rubric = "# Procedure\n1. First do X.\n2. Then do Y.";
    mockResolve.mockReturnValue({ ...baseConfig, prompt: rubric });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => ({ run: mockAgentRun, kill: mockAgentKill, config } as any),
    });

    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    try {
      const ctx: PipelineContext = { values: {} };
      await handler.execute(
        makeNode({ id: "n1", shape: "box", agent: "with-rubric", prompt: "Run the procedure on this input." }),
        ctx,
        makeContext({ logsRoot: logsDir }),
      );

      const writtenPrompt = readFileSync(join(logsDir, "n1", "prompt.md"), "utf8");

      // Rubric content present
      expect(writtenPrompt).toContain("# Procedure");
      expect(writtenPrompt).toContain("1. First do X.");
      expect(writtenPrompt).toContain("2. Then do Y.");
      // Task content present
      expect(writtenPrompt).toContain("Run the procedure on this input.");
      // Ordering: preamble → rubric → separator → task
      const preambleIdx = writtenPrompt.indexOf("Pipeline Context");
      const rubricIdx = writtenPrompt.indexOf("# Procedure");
      const separatorIdx = writtenPrompt.indexOf("\n\n---\n\n", rubricIdx);
      const taskIdx = writtenPrompt.indexOf("Run the procedure on this input.");
      expect(preambleIdx).toBeGreaterThanOrEqual(0);
      expect(rubricIdx).toBeGreaterThanOrEqual(0);
      expect(separatorIdx).toBeGreaterThanOrEqual(0);
      expect(taskIdx).toBeGreaterThanOrEqual(0);
      expect(preambleIdx).toBeLessThan(rubricIdx);
      expect(rubricIdx).toBeLessThan(separatorIdx);
      expect(separatorIdx).toBeLessThan(taskIdx);
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
    } as any);
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

  it("uses config.jsonSchema (from agent frontmatter outputs:) as schema source", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: JSON.stringify([{ type: "result", result: "", structured_output: { verdict: "true" } }]) });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    try {
      await handler.execute(
        makeNode(),
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

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
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
        makeNode(),
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

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
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
        makeNode(),
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

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
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
        makeNode(),
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

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
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
        makeNode(),
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

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: "not valid json" });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      const outcome = await handler.execute(
        makeNode(),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      expect(outcome.status).toBe("fail");
      expect(outcome.failureReason).toMatch(/output validation failed|JSON parse failed/i);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("parses JSON from result field when Claude prefixes prose before JSON (stream-json mode)", async () => {
    const schema = JSON.stringify({ type: "object", properties: { preferred_label: { type: "string" }, summary: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    // stream-json mode: structured_output is absent; result contains prose + JSON
    const proseResult = 'All three claims verified. Here\'s the verdict:\n\n{"preferred_label":"true","summary":"gap confirmed"}';
    const output = JSON.stringify([
      { type: "result", result: proseResult },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      const outcome = await handler.execute(
        makeNode(),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      expect(outcome.status).toBe("success");
      expect(outcome.preferredLabel).toBe("true");
      expect(outcome.contextUpdates?.["summary"]).toBe("gap confirmed");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("parses JSON when prose prefix contains literal ${...} brace markers", async () => {
    const schema = JSON.stringify({ type: "object", properties: { preferred_label: { type: "string" }, summary: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    // Agent quotes source code containing ${var} template syntax in its prose preamble.
    // Greedy /\{[\s\S]*\}/ would grab from `{agentRubric}` through the real JSON's
    // closing brace, producing invalid JSON. The extractor must anchor to `{"`.
    const proseResult = 'Already fixed via `${agentRubric}\\n---\\n${expandedTask}` concat.\n\n{"preferred_label":"false","summary":"stale"}';
    const output = JSON.stringify([
      { type: "result", result: proseResult },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      const outcome = await handler.execute(
        makeNode(),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      expect(outcome.status).toBe("success");
      expect(outcome.preferredLabel).toBe("false");
      expect(outcome.contextUpdates?.["summary"]).toBe("stale");
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

  it("max_iterations=0 runs until signal aborted", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    const ac = new AbortController();
    let callCount = 0;
    mockAgentRun.mockImplementation(async () => {
      callCount++;
      if (callCount === 3) ac.abort();
      return { exitCode: 0, output: "", sessionId: "s1" };
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 0 }),
      baseCtx(),
      makeContext({ signal: ac.signal }),
    );

    expect(callCount).toBe(3);
    expect(outcome.status).toBe("success");
  });

  it("max_iterations string '3' is parsed as number after variable expansion", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, output: "", sessionId: "s1" });

    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: "3" as unknown as number }),
      baseCtx(),
      makeContext({}),
    );

    expect(mockAgentRun).toHaveBeenCalledTimes(3);
  });

  it("calls onIterationStart for iterations 1+ and onIterationEnd for all but last", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    const starts: number[] = [];
    const ends: number[] = [];
    const ctx = makeContext({
      onIterationStart: (_nodeId: string, i: number) => starts.push(i),
      onIterationEnd: (_nodeId: string, i: number) => ends.push(i),
    });
    mockAgentRun.mockResolvedValue({ exitCode: 0, output: "", sessionId: "s1" });

    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: 3 }),
      baseCtx(),
      ctx,
    );

    // iteration 0: onNodeStart opens block (no onIterationStart)
    // iteration 1: onIterationStart(nodeId,1) before; onIterationEnd(nodeId,0) after iter 0
    // iteration 2: onIterationStart(nodeId,2) before; onIterationEnd(nodeId,1) after iter 1
    // iteration 2 end: onNodeEnd closes block (no onIterationEnd)
    expect(starts).toEqual([1, 2]);
    expect(ends).toEqual([0, 1]);
  });

  it("rubric $var stays literal while task $var expands", async () => {
    const rubric = "Run id context: `$run_id` is injected at runtime.";
    mockResolve.mockReturnValue({ ...baseConfig, prompt: rubric });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => ({ run: mockAgentRun, kill: mockAgentKill, config } as any),
    });

    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    try {
      const ctx: PipelineContext = { values: { task_var: "EXPANDED_VALUE" } };
      await handler.execute(
        makeNode({ id: "n1", shape: "box", agent: "var-rubric", prompt: "Node task references $task_var for expansion." }),
        ctx,
        makeContext({ logsRoot: logsDir }),
      );

      const writtenPrompt = readFileSync(join(logsDir, "n1", "prompt.md"), "utf8");
      // Rubric $run_id must remain literal (not expanded, not throw)
      expect(writtenPrompt).toContain("$run_id");
      // Task $task_var must be expanded
      expect(writtenPrompt).toContain("EXPANDED_VALUE");
      // Task variable placeholder must not remain
      expect(writtenPrompt).not.toContain("$task_var");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("spider-case rubric still expands $vars when node has no task", async () => {
    mockResolve.mockReturnValue({ ...baseConfig, prompt: "Spider instruction uses $spider_var." });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => ({ run: mockAgentRun, kill: mockAgentKill, config } as any),
    });

    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    try {
      const ctx: PipelineContext = { values: { spider_var: "SPIDER_VALUE" } };
      await handler.execute(
        makeNode({ id: "n1", shape: "box", agent: "spider-rubric", prompt: undefined, label: undefined }),
        ctx,
        makeContext({ logsRoot: logsDir }),
      );

      const writtenPrompt = readFileSync(join(logsDir, "n1", "prompt.md"), "utf8");
      expect(writtenPrompt).toContain("SPIDER_VALUE");
      expect(writtenPrompt).not.toContain("$spider_var");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("empty-rubric agent does not emit stray separator", async () => {
    mockResolve.mockReturnValue({ ...baseConfig, prompt: "" });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => ({ run: mockAgentRun, kill: mockAgentKill, config } as any),
    });

    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
    try {
      const ctx: PipelineContext = { values: {} };
      await handler.execute(
        makeNode({ id: "n1", shape: "box", agent: "empty-rubric", prompt: "Output exactly: 'hello'." }),
        ctx,
        makeContext({ logsRoot: logsDir }),
      );

      const writtenPrompt = readFileSync(join(logsDir, "n1", "prompt.md"), "utf8");
      expect(writtenPrompt).toContain("Output exactly: 'hello'.");
      expect(writtenPrompt).not.toContain("---\n\n---\n\n");
      expect(writtenPrompt).not.toMatch(/^\s*---\s*\n\nOutput/);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  describe("cap cascade", () => {
    it("loop:true with no cap defaults to Infinity (loops until signal abort)", async () => {
      mockResolve.mockReturnValue({ ...baseConfig, loop: true });

      const controller = new AbortController();
      let calls = 0;
      mockAgentRun.mockImplementation(async () => {
        calls++;
        if (calls >= 4) controller.abort();
        return { exitCode: 0, sessionId: `s${calls}`, stdout: null };
      });

      const handler = makeHandler();
      await handler.execute(
        makeNode(),
        baseCtx(),
        makeContext({ signal: controller.signal }),
      );
      expect(calls).toBe(4);
    });

    it("loop:false (default) caps at 1 iteration", async () => {
      mockResolve.mockReturnValue({ ...baseConfig });
      mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s", stdout: null });

      const handler = makeHandler();
      await handler.execute(makeNode(), baseCtx(), makeContext());
      expect(mockAgentRun).toHaveBeenCalledTimes(1);
    });

    it("node.maxIterations overrides agent.maxIterations", async () => {
      mockResolve.mockReturnValue({ ...baseConfig, loop: true, maxIterations: 20 });
      mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s", stdout: null });

      const handler = makeHandler();
      await handler.execute(
        makeNode({ maxIterations: 3 }),
        baseCtx(),
        makeContext(),
      );
      expect(mockAgentRun).toHaveBeenCalledTimes(3);
    });

    it("agent.maxIterations applies when node has none", async () => {
      mockResolve.mockReturnValue({ ...baseConfig, loop: true, maxIterations: 2 });
      mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s", stdout: null });

      const handler = makeHandler();
      await handler.execute(makeNode(), baseCtx(), makeContext());
      expect(mockAgentRun).toHaveBeenCalledTimes(2);
    });

    it("max_iterations=0 maps to Infinity at node level (back-compat)", async () => {
      mockResolve.mockReturnValue({ ...baseConfig, loop: true });

      const controller = new AbortController();
      let calls = 0;
      mockAgentRun.mockImplementation(async () => {
        calls++;
        if (calls >= 3) controller.abort();
        return { exitCode: 0, sessionId: `s${calls}`, stdout: null };
      });

      const handler = makeHandler();
      await handler.execute(
        makeNode({ maxIterations: 0 }),
        baseCtx(),
        makeContext({ signal: controller.signal }),
      );
      expect(calls).toBe(3);
    });
  });

});
