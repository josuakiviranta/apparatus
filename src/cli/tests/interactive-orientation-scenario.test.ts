import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { buildAgentPrompt } from "../../attractor/handlers/agent-prep.js";
import { GROUNDED_OPENING_BLOCK } from "../../attractor/transforms/grounded-opening.js";
import type { Node, PipelineContext } from "../../attractor/types.js";
import type { HandlerExecutionContext } from "../../attractor/handlers/registry.js";
import type { AgentConfig } from "../lib/agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, "../../../.apparat/scenarios/interactive-orientation");
const SCENARIO_DOT = join(SCENARIO_DIR, "pipeline.dot");
const SCENARIO_AGENT = join(SCENARIO_DIR, "fake-chat.md");

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "fake-chat",
    description: "",
    model: "sonnet",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "AGENT INSTRUCTIONS",
    inputs: ["verifier_summary"],
    ...overrides,
  } as AgentConfig;
}

function makeMeta(cwd: string): HandlerExecutionContext {
  return {
    cwd,
    logsRoot: cwd,
    dotDir: cwd,
    completedNodes: [],
    nodeRetries: {},
    outgoingLabels: [],
  };
}

describe("scenario: interactive-orientation", () => {
  it("scenario fixture files exist with the expected literal canary", () => {
    expect(existsSync(SCENARIO_DOT)).toBe(true);
    expect(existsSync(SCENARIO_AGENT)).toBe(true);
    const dot = readFileSync(SCENARIO_DOT, "utf8");
    // The frozen canary the LLM-driven half also asserts on.
    expect(dot).toContain("MAGIC_TOKEN_FOR_TEST_42");
    // The node is interactive — this is the engine-trigger contract.
    expect(dot).toMatch(/interactive\s*=\s*"?true"?/);
  });

  it("buildAgentPrompt appends GROUNDED_OPENING_BLOCK for an interactive node", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-orient-scenario-"));
    try {
      const node: Node = {
        id: "chat",
        agent: "fake-chat",
        interactive: true,
        defaultVerifierSummary: "MAGIC_TOKEN_FOR_TEST_42",
      };
      const ctx: PipelineContext = { values: {} };
      const built = buildAgentPrompt(node, ctx, makeMeta(tmp), () => makeConfig());
      expect("fail" in built).toBe(false);
      const ok = built as Exclude<typeof built, { fail: string }>;
      // The block is present verbatim.
      expect(ok.prompt).toContain(GROUNDED_OPENING_BLOCK);
      // The Inputs block carried the canary through to the assembled prompt.
      expect(ok.prompt).toContain("MAGIC_TOKEN_FOR_TEST_42");
      // The block sits AFTER the inputs+steering portion: indexOf check.
      expect(ok.prompt.indexOf("MAGIC_TOKEN_FOR_TEST_42"))
        .toBeLessThan(ok.prompt.indexOf(GROUNDED_OPENING_BLOCK));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("buildAgentPrompt does NOT append the block for a non-interactive node", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-orient-scenario-off-"));
    try {
      const node: Node = {
        id: "chat",
        agent: "fake-chat",
        defaultVerifierSummary: "MAGIC_TOKEN_FOR_TEST_42",
      };
      const ctx: PipelineContext = { values: {} };
      const built = buildAgentPrompt(node, ctx, makeMeta(tmp), () => makeConfig());
      const ok = built as Exclude<typeof built, { fail: string }>;
      expect(ok.prompt).not.toContain(GROUNDED_OPENING_BLOCK);
      expect(ok.prompt).not.toContain("## Grounded opening (mandatory)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
