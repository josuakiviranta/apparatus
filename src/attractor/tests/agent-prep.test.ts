import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assembleAgentPrompt, buildAgentPrompt } from "../handlers/agent-prep.js";
import type { AgentConfig } from "../../cli/lib/agent.js";
import type { Node, PipelineContext } from "../types.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";

function makeConfig(): AgentConfig {
  return {
    name: "fake",
    description: "",
    model: "opus",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "AGENT INSTRUCTIONS",
  } as AgentConfig;
}

function makeMeta(cwd: string, logsRoot: string): HandlerExecutionContext {
  return {
    cwd,
    logsRoot,
    dotDir: cwd,
    completedNodes: [],
    nodeRetries: {},
    outgoingLabels: [],
  };
}

describe("assembleAgentPrompt", () => {
  it("returns prep object with prompt, agent, config, jsonSchema, agentVariables, nodeDir", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-prep-"));
    try {
      const cfg = makeConfig();
      const node: Node = { id: "n1", prompt: "STEERING", agent: "fake" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);

      const fakeAgent = { run: async () => ({ exitCode: 0, sessionId: null, stdout: null }) } as any;

      const prep = assembleAgentPrompt(node, ctx, meta, () => cfg, () => fakeAgent);

      // PreparedAgent shape
      expect("fail" in prep).toBe(false);
      const ok = prep as Exclude<typeof prep, { fail: string }>;
      expect(ok.config.name).toBe("fake");
      expect(ok.agent).toBe(fakeAgent);
      expect(ok.jsonSchema).toBeUndefined();
      expect(ok.agentVariables).toBeDefined();
      expect(ok.prompt).toContain("AGENT INSTRUCTIONS");
      expect(ok.prompt).toContain("STEERING");
      expect(ok.nodeDir).toBe(join(tmp, "n1"));

      // prompt.md is written to nodeDir
      const onDisk = readFileSync(join(ok.nodeDir, "prompt.md"), "utf8");
      expect(onDisk).toBe(ok.prompt);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns { fail } when loadAgent throws", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-prep-"));
    try {
      const node: Node = { id: "n1", agent: "missing" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);
      const result = assembleAgentPrompt(
        node, ctx, meta,
        () => { throw new Error("agent file not found"); },
        () => ({} as any),
      );
      expect("fail" in result).toBe(true);
      if ("fail" in result) {
        expect(result.fail).toMatch(/Failed to resolve agent "missing"/);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("wraps prompt with JSON-schema framing when config.jsonSchema is set", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-prep-"));
    try {
      const cfg = { ...makeConfig(), jsonSchema: '{"type":"object"}' };
      const node: Node = { id: "n1", prompt: "p", agent: "fake" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);
      const prep = assembleAgentPrompt(node, ctx, meta, () => cfg, () => ({} as any));
      expect("fail" in prep).toBe(false);
      const ok = prep as Exclude<typeof prep, { fail: string }>;
      expect(ok.jsonSchema).toBe('{"type":"object"}');
      expect(ok.prompt).toContain("Your FINAL response MUST be valid JSON");
      expect(ok.prompt).toContain('Schema: {"type":"object"}');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("buildAgentPrompt", () => {
  it("returns BuiltPrompt and does NOT write prompt.md to nodeDir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-build-"));
    try {
      const cfg = makeConfig();
      const node: Node = { id: "n1", prompt: "STEERING", agent: "fake" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);

      const built = buildAgentPrompt(node, ctx, meta, () => cfg);

      expect("fail" in built).toBe(false);
      const ok = built as Exclude<typeof built, { fail: string }>;
      expect(ok.prompt).toContain("AGENT INSTRUCTIONS");
      expect(ok.prompt).toContain("STEERING");
      expect(ok.nodeDir).toBe(join(tmp, "n1"));

      // The pure core MUST NOT touch the filesystem.
      expect(existsSync(join(ok.nodeDir, "prompt.md"))).toBe(false);
      expect(existsSync(ok.nodeDir)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns identical `prompt` bytes as assembleAgentPrompt for the same inputs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-parity-"));
    try {
      const cfg = makeConfig();
      const node: Node = { id: "n1", prompt: "STEERING", agent: "fake" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);

      const built = buildAgentPrompt(node, ctx, meta, () => cfg);
      const prep = assembleAgentPrompt(node, ctx, meta, () => cfg, () => ({} as any));

      expect("fail" in built).toBe(false);
      expect("fail" in prep).toBe(false);
      const builtOk = built as Exclude<typeof built, { fail: string }>;
      const prepOk = prep as Exclude<typeof prep, { fail: string }>;

      expect(builtOk.prompt).toBe(prepOk.prompt);
      expect(builtOk.nodeDir).toBe(prepOk.nodeDir);
      expect(builtOk.jsonSchema).toBe(prepOk.jsonSchema);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns { fail } when load throws", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-build-"));
    try {
      const node: Node = { id: "n1", agent: "missing" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);

      const built = buildAgentPrompt(
        node, ctx, meta,
        () => { throw new Error("agent file not found"); },
      );

      expect("fail" in built).toBe(true);
      if ("fail" in built) {
        expect(built.fail).toMatch(/Failed to resolve agent "missing"/);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
