import { describe, it, expect } from "vitest";
import {
  validateAgentConfig,
  Agent,
  type AgentConfig,
} from "../lib/agent.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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

describe("Agent.buildArgs", () => {
  const baseConfig: AgentConfig = {
    name: "builder",
    description: "Builds things",
    model: "sonnet",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "You are a builder.",
  };

  it("includes model and --dangerously-skip-permissions flag", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildArgs({ cwd: "/tmp" });
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("-p");
  });

  it("uses --permission-mode for non-skip values", () => {
    const agent = new Agent({ ...baseConfig, permissionMode: "dontAsk" });
    const args = agent.buildArgs({ cwd: "/tmp" });
    expect(args).toContain("--permission-mode");
    expect(args).toContain("dontAsk");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("includes --allowedTools for each tool", () => {
    const agent = new Agent({
      ...baseConfig,
      tools: ["read_file", "write_file"],
    });
    const args = agent.buildArgs({ cwd: "/tmp" });
    expect(args).toContain("--allowedTools");
    expect(args).toContain("read_file");
    expect(args).toContain("write_file");
  });

  it("uses --resume instead of prompt when resuming", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildArgs({ cwd: "/tmp", resume: "session-123" });
    expect(args).toContain("--resume");
    expect(args).toContain("session-123");
    expect(args).not.toContain("-p");
  });

  it("omits --output-format when interactive", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildArgs({ cwd: "/tmp", interactive: true });
    expect(args).not.toContain("--output-format");
  });

  it("includes --output-format stream-json when not interactive", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildArgs({ cwd: "/tmp" });
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
  });
});

describe("Agent.expandPrompt", () => {
  const config: AgentConfig = {
    name: "test",
    description: "test",
    model: "opus",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "Hello {{NAME}}, you work on {{PROJECT}}.",
  };

  it("replaces variables in prompt", () => {
    const agent = new Agent(config);
    const result = agent.expandPrompt({ NAME: "Alice", PROJECT: "foo" });
    expect(result).toBe("Hello Alice, you work on foo.");
  });

  it("leaves unknown variables as-is", () => {
    const agent = new Agent(config);
    const result = agent.expandPrompt({ NAME: "Bob" });
    expect(result).toBe("Hello Bob, you work on {{PROJECT}}.");
  });

  it("returns prompt unchanged when no variables", () => {
    const agent = new Agent(config);
    const result = agent.expandPrompt();
    expect(result).toBe("Hello {{NAME}}, you work on {{PROJECT}}.");
  });
});

describe("Agent MCP config lifecycle", () => {
  const mcpConfig: AgentConfig = {
    name: "mcp-agent",
    description: "Agent with MCP",
    model: "opus",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [
      { name: "test-server", command: "node", args: ["server.js"] },
    ],
    prompt: "Do something.",
  };

  const noMcpConfig: AgentConfig = {
    ...mcpConfig,
    mcp: [],
  };

  it("writeMcpConfig returns null when no MCP servers", () => {
    const agent = new Agent(noMcpConfig);
    const result = agent.writeMcpConfig("/tmp");
    expect(result).toBeNull();
  });

  it("writeMcpConfig writes JSON file and returns path", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-"));
    try {
      const agent = new Agent(mcpConfig);
      const configPath = agent.writeMcpConfig(tmpDir);
      expect(configPath).not.toBeNull();
      expect(fs.existsSync(configPath!)).toBe(true);
      const content = JSON.parse(fs.readFileSync(configPath!, "utf-8"));
      expect(content.mcpServers["test-server"]).toEqual({
        command: "node",
        args: ["server.js"],
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("cleanupMcpConfig removes the file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-"));
    try {
      const agent = new Agent(mcpConfig);
      agent.writeMcpConfig(tmpDir);
      agent.cleanupMcpConfig();
      expect(agent.mcpConfigPath).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("buildArgs includes --mcp-config when mcpConfigPath is set", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-"));
    try {
      const agent = new Agent(mcpConfig);
      agent.writeMcpConfig(tmpDir);
      const args = agent.buildArgs({ cwd: tmpDir });
      expect(args).toContain("--mcp-config");
      agent.cleanupMcpConfig();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writeMcpConfig expands variables in server args", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-"));
    try {
      const varConfig: AgentConfig = {
        ...mcpConfig,
        mcp: [
          {
            name: "illumination",
            command: "node",
            args: ["{{SERVER_PATH}}", "{{PROJECT_ROOT}}", "{{META_DIR}}"],
          },
        ],
      };
      const agent = new Agent(varConfig);
      const configPath = agent.writeMcpConfig(tmpDir, {
        SERVER_PATH: "/usr/bin/server.js",
        PROJECT_ROOT: "/my/project",
        META_DIR: "/my/meditations",
      });
      expect(configPath).not.toBeNull();
      const content = JSON.parse(fs.readFileSync(configPath!, "utf-8"));
      expect(content.mcpServers.illumination.args).toEqual([
        "/usr/bin/server.js",
        "/my/project",
        "/my/meditations",
      ]);
      agent.cleanupMcpConfig();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writeMcpConfig expands variables in command", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mcp-"));
    try {
      const varConfig: AgentConfig = {
        ...mcpConfig,
        mcp: [
          {
            name: "test",
            command: "{{CMD}}",
            args: ["arg1"],
          },
        ],
      };
      const agent = new Agent(varConfig);
      const configPath = agent.writeMcpConfig(tmpDir, { CMD: "tsx" });
      const content = JSON.parse(fs.readFileSync(configPath!, "utf-8"));
      expect(content.mcpServers.test.command).toBe("tsx");
      agent.cleanupMcpConfig();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
