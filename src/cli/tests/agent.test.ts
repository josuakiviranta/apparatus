import { describe, it, expect, vi } from "vitest";
import {
  validateAgentConfig,
  Agent,
  type AgentConfig,
} from "../lib/agent.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Allow spawn to be mocked for the readline completion test
const { mockSpawn } = vi.hoisted(() => {
  return { mockSpawn: vi.fn() };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: any[]) => {
    const override = mockSpawn();
    if (override) return override;
    return actual.spawn(...(args as Parameters<typeof actual.spawn>));
  }};
});

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

  it("accepts empty prompt for procedure-less agents (e.g. task)", () => {
    const config = { ...validConfig, prompt: "" };
    expect(() => validateAgentConfig(config)).not.toThrow();
    expect(validateAgentConfig(config).prompt).toBe("");
  });

  it("rejects prompt that is not a string", () => {
    const config = { ...validConfig, prompt: undefined as unknown as string };
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
    // claude CLI requires --verbose when -p pairs with stream-json
    expect(args).toContain("--verbose");
  });

  it("omits --verbose when interactive", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildArgs({ cwd: "/tmp", interactive: true });
    expect(args).not.toContain("--verbose");
  });

  it("uses stream-json even when jsonSchema is set (schema is in prompt)", () => {
    const agent = new Agent({ ...baseConfig, jsonSchema: '{"type":"object"}' });
    const args = agent.buildArgs({ cwd: "/tmp" });
    expect(args).not.toContain("--json-schema");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
  });

  it("uses stream-json when jsonSchema is not set", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildArgs({ cwd: "/tmp" });
    expect(args).toContain("stream-json");
    expect(args).not.toContain("--json-schema");
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

describe("Agent.run readline completion", () => {
  it("captures all output lines before returning", async () => {
    // Verifies that agent.run() awaits readline close before returning
    // capturedOutput, preventing data loss from the child process closing
    // before readline finishes processing buffered data.
    const { Readable } = await import("node:stream");
    const { EventEmitter } = await import("node:events");

    const config: AgentConfig = {
      name: "test",
      description: "test",
      model: "opus",
      permissionMode: "dangerouslySkipPermissions",
      tools: [],
      mcp: [],
      prompt: "test prompt",
      jsonSchema: '{"type":"object"}',
    };

    // Create a mock child process that emits lines then closes
    const mockStdout = new Readable({ read() {} });
    const mockChild = Object.assign(new EventEmitter(), {
      pid: 12345,
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: mockStdout,
      stderr: null,
    });

    // Activate mock spawn for this test only
    mockSpawn.mockReturnValueOnce(mockChild);

    const agent = new Agent(config);
    const runPromise = agent.run({ cwd: "/tmp" });

    // Push data then close — simulate child exiting
    const jsonLine = JSON.stringify({ result: '{"answer":"42"}', session_id: "s1" });
    mockStdout.push(jsonLine + "\n");
    mockStdout.push(null); // EOF
    // Emit close after a tick to simulate real child process timing
    setTimeout(() => mockChild.emit("close", 0), 5);

    const result = await runPromise;
    expect(result.output).toContain('"result"');
    expect(result.output!.trim().length).toBeGreaterThan(0);
    expect(result.sessionId).toBe("s1");
  });
});

describe("Agent.run abort signal", () => {
  it("kills child process when abort signal fires during run", async () => {
    const ac = new AbortController();

    const killFn = vi.fn((_sig: string) => {});
    const mockChild = {
      killed: false,
      kill: vi.fn((sig: string) => {
        mockChild.killed = true;
        killFn(sig);
      }),
      on: vi.fn((event: string, cb: (code: number) => void) => {
        if (event === "close") {
          setTimeout(() => cb(0), 50);
        }
      }),
      once: vi.fn((_event: string, _cb: () => void) => {}),
      stdin: {
        write: vi.fn((_data: unknown, cb?: (err?: Error) => void) => {
          cb?.();
        }),
        end: vi.fn(),
      },
      stdout: null,
      stderr: null,
    };

    mockSpawn.mockReturnValueOnce(mockChild as any);

    const agent = new Agent({
      name: "test",
      description: "",
      model: "opus",
      permissionMode: "dangerouslySkipPermissions",
      tools: [],
      mcp: [],
      prompt: "hello",
    });

    const runPromise = agent.run({ cwd: "/tmp", signal: ac.signal });

    // Let spawn execute and the abort listener be registered
    await new Promise((r) => setImmediate(r));
    ac.abort();

    await runPromise;

    expect(killFn).toHaveBeenCalledWith("SIGTERM");
  });
});
