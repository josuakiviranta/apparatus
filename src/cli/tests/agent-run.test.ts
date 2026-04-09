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
    // Should not include -p when resuming
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).not.toContain("-p");
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
