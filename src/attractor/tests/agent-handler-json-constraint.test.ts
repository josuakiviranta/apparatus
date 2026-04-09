/**
 * Tests that verify the JSON constraint is injected into the prompt when jsonSchema is set.
 *
 * Root cause documented in: memory/2026-04-13-json-schema-agentic-sessions.md
 * The --json-schema CLI flag alone does not constrain the model's final message in long
 * agentic sessions. An explicit prompt-level instruction must also be injected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";
import type { Node, PipelineContext } from "../types.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const baseCtx = (): PipelineContext => ({ values: {} });

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
    const schemaDir = join(logsDir, "schemas");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, "test.json"), schema);

    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: '{"verdict":"pass"}' });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    try {
      await handler.execute(
        makeNode({ prompt: "Verify the implementation", jsonSchemaFile: "schemas/test.json" } as any),
        baseCtx(),
        { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
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
    const schemaDir = join(logsDir, "schemas");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, "test.json"), schema);

    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: '{"verdict":"pass"}' });

    let capturedConfig: any = null;
    const handler = new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: (config) => { capturedConfig = config; return { run: mockAgentRun, kill: mockAgentKill, config } as any; },
    });

    try {
      await handler.execute(
        makeNode({ prompt: "Verify the implementation", jsonSchemaFile: "schemas/test.json" } as any),
        baseCtx(),
        { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
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
        { logsRoot: logsDir, cwd: "/tmp/project", signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
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
    const schemaDir = join(logsDir, "schemas");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, "test.json"), schema);

    mockResolve.mockReturnValue({ ...baseConfig });
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
        makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
        baseCtx(),
        { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
      );

      // Must surface as failure, not silently repair
      expect(outcome.status).toBe("fail");
      expect(outcome.failureReason).toContain("Structured output parsing failed");
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });
});
