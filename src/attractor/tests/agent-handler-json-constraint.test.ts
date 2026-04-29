/**
 * Tests that verify the JSON constraint is injected into the prompt when jsonSchema is set.
 *
 * Root cause documented in: memory/2026-04-13-json-schema-agentic-sessions.md
 * The --json-schema CLI flag alone does not constrain the model's final message in long
 * agentic sessions. An explicit prompt-level instruction must also be injected.
 *
 * After Task 3.2 migration: jsonSchema is sourced exclusively from agent frontmatter
 * outputs: (via config.jsonSchema). The legacy json_schema_file= node attribute is removed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";
import type { Node, PipelineContext } from "../types.js";
import { existsSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const baseCtx = (): PipelineContext => ({ values: {} });

function makeContext(overrides: Partial<HandlerExecutionContext> = {}): HandlerExecutionContext {
  return { logsRoot: "/tmp/logs", cwd: "/tmp/project", dotDir: "/tmp/project", outgoingLabels: [], completedNodes: [], nodeRetries: {}, ...overrides };
}

describe("AgentHandler – JSON constraint injection", () => {
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

  const baseConfig = {
    name: "implement",
    description: "Autonomous code implementation",
    model: "opus",
    prompt: "Do things",
    tools: [] as string[],
    mcp: [] as any[],
    permissionMode: "dangerouslySkipPermissions",
  };

  it("prepends JSON constraint to prompt when jsonSchema is set", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: JSON.stringify([{ type: "result", result: "", structured_output: { verdict: "pass" } }]) });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    try {
      await handler.execute(
        makeNode({ prompt: "Verify the implementation" }),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      // The JSON constraint must appear BEFORE the node prompt (prepended)
      const constraintIndex = capturedConfig.prompt.indexOf("MUST be valid JSON");
      const nodePromptIndex = capturedConfig.prompt.indexOf("Verify the implementation");
      expect(constraintIndex).toBeGreaterThanOrEqual(0);
      expect(nodePromptIndex).toBeGreaterThanOrEqual(0);
      expect(constraintIndex).toBeLessThan(nodePromptIndex);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("appends JSON constraint to prompt when jsonSchema is set", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: JSON.stringify([{ type: "result", result: "", structured_output: { verdict: "pass" } }]) });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    try {
      await handler.execute(
        makeNode({ prompt: "Verify the implementation" }),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      // The JSON constraint must also appear AFTER the node prompt (appended)
      const nodePromptIndex = capturedConfig.prompt.indexOf("Verify the implementation");
      const lastConstraintIndex = capturedConfig.prompt.lastIndexOf("MUST be valid JSON");
      expect(lastConstraintIndex).toBeGreaterThan(nodePromptIndex);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("does NOT inject JSON constraint when jsonSchema is absent", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));
    try {
      await handler.execute(
        makeNode({ prompt: "Verify the implementation" }),
        baseCtx(),
        makeContext({ logsRoot: logsDir }),
      );

      expect(capturedConfig.prompt).not.toContain("MUST be valid JSON");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("returns fail (not repair) when structured output is markdown prose — documents known failure mode", async () => {
    // This test documents the failure mode explicitly per memory/2026-04-13-json-schema-agentic-sessions.md:
    // "always write a test that simulates the flag being ignored to verify graceful failure"
    // Parse-repair (Change 2) MUST NOT be applied — it would cause this test to pass silently
    // with garbled data instead of surfacing the failure to the pipeline.
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    // Simulate the real failure: model returns markdown despite --json-schema flag
    mockAgentRun.mockResolvedValue({
      exitCode: 0,
      sessionId: null,
      stdout: null,
      output: "**Verdict:** The implementation looks correct.\n\nAll checks passed.",
    });

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

      // Must surface as failure, not silently repair
      expect(outcome.status).toBe("fail");
      expect(outcome.failureReason).toMatch(/output validation failed|JSON parse failed|no \{type:"result"\}/i);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("parses JSON array output and extracts structured_output from result event", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    // Real Claude CLI --output-format json: JSON array with structured_output
    const jsonArray = JSON.stringify([
      { type: "assistant", message: { content: "thinking..." } },
      { type: "tool_use", tool: "Read", input: { path: "/tmp/x" } },
      { type: "result", result: "", structured_output: { verdict: "pass", notes: "all good" } },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: jsonArray });

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
      expect(outcome.contextUpdates?.["work.verdict"]).toBe("pass");
      expect(outcome.contextUpdates?.["work.notes"]).toBe("all good");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("returns descriptive failure when output has no {type:'result'} event", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    // Truncated session: JSON array with events but no result
    const jsonArray = JSON.stringify([
      { type: "assistant", message: { content: "working..." } },
      { type: "tool_use", tool: "Bash", input: { command: "ls" } },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: jsonArray });

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
      expect(outcome.failureReason).toMatch(/output validation failed|no \{type:"result"\}/i);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("parses structured_output when it is a raw object", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    // structured_output as raw object (not stringified) — exercises the non-string branch
    const jsonArray = JSON.stringify([
      { type: "assistant", message: { content: "done" } },
      { type: "result", result: "", structured_output: { verdict: "pass" } },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: jsonArray });

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
      expect(outcome.contextUpdates?.["work.verdict"]).toBe("pass");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("writes raw-attempt-1.txt to nodeDir when jsonSchema output is present", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    const jsonArray = JSON.stringify([
      { type: "result", result: "", structured_output: { verdict: "pass" } },
    ]);
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: jsonArray });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      await handler.execute(
        makeNode(),
        baseCtx(),
        makeContext({ logsRoot: logsDir, cwd: logsDir, dotDir: logsDir }),
      );

      // new code writes raw-attempt-1.txt (validation+retry loop)
      expect(existsSync(join(logsDir, "work", "raw-attempt-1.txt"))).toBe(true);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("uses config.jsonSchema (from agent frontmatter) independent of dotDir/cwd", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] });
    const dotDir = mkdtempSync(join(tmpdir(), "ralph-dotdir-"));
    const projectDir = mkdtempSync(join(tmpdir(), "ralph-project-"));
    // NOTE: schema is passed via config.jsonSchema — no file needed in any dir

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    mockAgentRun.mockResolvedValue({
      exitCode: 0, sessionId: null, stdout: null,
      output: JSON.stringify([{ type: "result", result: "", structured_output: { verdict: "pass" } }]),
    });

    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
    });

    try {
      const outcome = await handler.execute(
        makeNode({ prompt: "Verify" }),
        baseCtx(),
        makeContext({ logsRoot: projectDir, cwd: projectDir, dotDir: dotDir }),
      );

      expect(outcome.status).toBe("success");
    } finally {
      rmSync(dotDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns descriptive failure when agent produces no output", async () => {
    const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
    const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));

    mockResolve.mockReturnValue({ ...baseConfig, jsonSchema: schema });
    // Simulate timeout: agent exits without producing output
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: undefined });

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
      expect(outcome.failureReason).toMatch(/agent produced no output|no text content|output validation failed/i);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });
});
