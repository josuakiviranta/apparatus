import { describe, it, expect } from "vitest";
import { validateAgentConfig, type AgentConfig } from "../lib/agent.js";

describe("validateAgentConfig", () => {
  const validConfig: AgentConfig = {
    name: "reviewer",
    description: "Reviews code",
    model: "sonnet",
    permissionMode: "dontAsk",
    tools: ["read_file"],
    mcp: [],
    prompt: "You are a reviewer.",
  };

  it("accepts a valid config", () => {
    expect(() => validateAgentConfig(validConfig)).not.toThrow();
  });

  it("rejects missing name", () => {
    const config = { ...validConfig, name: "" };
    expect(() => validateAgentConfig(config)).toThrow("name is required");
  });

  it("rejects missing description", () => {
    const config = { ...validConfig, description: "" };
    expect(() => validateAgentConfig(config)).toThrow("description is required");
  });

  it("rejects missing prompt", () => {
    const config = { ...validConfig, prompt: "" };
    expect(() => validateAgentConfig(config)).toThrow("prompt body is required");
  });

  it("applies defaults for optional fields", () => {
    const minimal = {
      name: "test",
      description: "test agent",
      prompt: "Do things.",
    };
    const result = validateAgentConfig(minimal as AgentConfig);
    expect(result.model).toBe("opus");
    expect(result.permissionMode).toBe("dangerouslySkipPermissions");
    expect(result.tools).toEqual([]);
    expect(result.mcp).toEqual([]);
  });
});
