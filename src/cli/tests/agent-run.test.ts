import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent, type AgentConfig } from "../lib/agent.js";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
const mockSpawn = vi.mocked(spawn);

function createMockChild(exitCode = 0, stdoutData = "") {
  const child = new EventEmitter() as any;
  child.pid = 12345;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new Readable({
    read() {
      if (stdoutData) {
        this.push(stdoutData);
        stdoutData = "";
      } else {
        this.push(null);
      }
    },
  });
  child.stderr = null;

  // Emit close after a tick
  process.nextTick(() => {
    child.emit("close", exitCode);
  });

  return child;
}

describe("Agent.run", () => {
  const baseConfig: AgentConfig = {
    name: "runner",
    description: "Runs stuff",
    model: "sonnet",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "Do the thing for {{PROJECT}}.",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns claude with -p and pipes prompt to stdin", async () => {
    const child = createMockChild(0);
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const result = await agent.run({
      cwd: "/tmp/project",
      variables: { PROJECT: "my-app" },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p", "--model", "sonnet"]),
      expect.objectContaining({ cwd: "/tmp/project" }),
    );
    expect(child.stdin.write).toHaveBeenCalledWith(
      "Do the thing for my-app.",
    );
    expect(child.stdin.end).toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  it("uses inherited stdio when interactive", async () => {
    const child = createMockChild(0);
    child.stdout = null;
    child.stdin = null;
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const result = await agent.run({
      cwd: "/tmp/project",
      interactive: true,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      expect.not.arrayContaining(["-p"]),
      expect.objectContaining({ stdio: "inherit" }),
    );
    expect(result.stdout).toBeNull();
  });

  it("uses --resume when resume option provided", async () => {
    const child = createMockChild(0);
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    await agent.run({
      cwd: "/tmp/project",
      resume: "sess-abc",
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--resume", "sess-abc"]),
      expect.any(Object),
    );
    // -p is now included on resume too — corrective message goes via stdin
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("-p");
  });

  it("captures session ID from stream-json output", async () => {
    const sessionLine = JSON.stringify({
      type: "system",
      session_id: "sess-xyz-123",
    });
    const child = createMockChild(0, sessionLine + "\n");
    mockSpawn.mockReturnValue(child);

    let capturedId: string | undefined;
    const agent = new Agent(baseConfig);
    const result = await agent.run({
      cwd: "/tmp/project",
      onSessionId: (id) => {
        capturedId = id;
      },
    });

    expect(result.sessionId).toBe("sess-xyz-123");
    expect(capturedId).toBe("sess-xyz-123");
  });

  it("calls onStdout callback with child stdout stream", async () => {
    const child = createMockChild(0, "some output\n");
    mockSpawn.mockReturnValue(child);

    let receivedStdout: NodeJS.ReadableStream | undefined;
    const agent = new Agent(baseConfig);
    const result = await agent.run({
      cwd: "/tmp/project",
      onStdout: async (stdout) => {
        receivedStdout = stdout;
        // Consume the stream so it ends
        for await (const _chunk of stdout) {
          // drain
        }
      },
    });

    expect(receivedStdout).toBe(child.stdout);
    expect(result.exitCode).toBe(0);
  });

  it("returns exit code from child process", async () => {
    const child = createMockChild(1);
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const result = await agent.run({ cwd: "/tmp/project" });
    expect(result.exitCode).toBe(1);
  });
});

describe("Agent.run with jsonSchema", () => {
  const jsonSchemaConfig: AgentConfig = {
    name: "runner",
    description: "Runs stuff",
    model: "sonnet",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "Do the thing for {{PROJECT}}.",
    jsonSchema: "/tmp/schema.json",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tees NDJSON lines to onStdout and captures output when jsonSchema is set", async () => {
    // With stream-json, each event is a separate NDJSON line (not a JSON array)
    const systemLine = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-json-001",
      cwd: "/tmp/project",
    });
    const resultLine = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 1,
      result: "",
      structured_output: { summary: "test output" },
      session_id: "sess-json-001",
      usage: { input_tokens: 42, output_tokens: 17 },
    });
    const child = createMockChild(0, systemLine + "\n" + resultLine + "\n");
    mockSpawn.mockReturnValue(child);

    const receivedLines: string[] = [];
    const agent = new Agent(jsonSchemaConfig);
    await agent.run({
      cwd: "/tmp/project",
      onStdout: async (stdout) => {
        for await (const chunk of stdout) {
          receivedLines.push(...chunk.toString().split("\n").filter(Boolean));
        }
      },
    });

    // Raw NDJSON lines are forwarded directly (no synthetic reconstruction)
    const systemEvent = receivedLines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((e) => e?.type === "system");
    expect(systemEvent?.session_id).toBe("sess-json-001");

    const resultEvent = receivedLines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((e) => e?.type === "result");
    expect(resultEvent?.usage?.input_tokens).toBe(42);
    expect(resultEvent?.usage?.output_tokens).toBe(17);
  });

  it("always calls onStdout (even for non-JSON lines) when jsonSchema is set", async () => {
    const child = createMockChild(0, "not json\n");
    mockSpawn.mockReturnValue(child);

    let onStdoutCalled = false;
    const agent = new Agent(jsonSchemaConfig);
    await agent.run({
      cwd: "/tmp/project",
      onStdout: async () => { onStdoutCalled = true; },
    });

    // With stream-json tee, onStdout is always called (passThrough is always provided)
    expect(onStdoutCalled).toBe(true);
  });

  it("still buffers output and extracts sessionId from NDJSON lines", async () => {
    const resultLine = JSON.stringify({
      type: "result",
      result: "",
      structured_output: { key: "val" },
      session_id: "s1",
      usage: {},
    });
    const child = createMockChild(0, resultLine + "\n");
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(jsonSchemaConfig);
    const result = await agent.run({ cwd: "/tmp/project" });

    expect(result.output).toContain('"key":"val"');
    expect(result.sessionId).toBe("s1");
  });
});
