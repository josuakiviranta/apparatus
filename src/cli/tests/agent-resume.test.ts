import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { Agent } from "../lib/agent.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("Agent.run resume support", () => {
  beforeEach(() => {
    (spawn as any).mockReset();
  });

  it("on resume, buildArgs includes --resume <sessionId>", () => {
    const a = new Agent({
      name: "a", description: "d", model: "opus",
      permissionMode: "default", tools: [], mcp: [], prompt: "system prompt",
    } as any);
    const args = a.buildArgs({ cwd: ".", resume: "sess-123" });
    expect(args).toContain("--resume");
    expect(args).toContain("sess-123");
  });

  it("on resume with message, pipes only the message to stdin (not system prompt)", async () => {
    const writes: string[] = [];
    const fakeChild: any = {
      stdin: { write: (c: string) => writes.push(c), end: () => {}, destroyed: false },
      stdout: null,
      once: vi.fn(),
      on: vi.fn(),
      kill: vi.fn(),
      pid: 1234,
    };
    (spawn as any).mockReturnValue(fakeChild);

    const a = new Agent({
      name: "a", description: "d", model: "opus",
      permissionMode: "dangerouslySkipPermissions", tools: [], mcp: [], prompt: "system",
    } as any);

    void a.run({ cwd: ".", resume: "s-1", message: "fix your output" }).catch(() => {});
    await new Promise(r => setTimeout(r, 10));

    expect(writes).toContain("fix your output");
    expect(writes.find(w => w.includes("system"))).toBeUndefined();
  });

  it("on resume, spawn args include -p (so prompt-mode is active)", async () => {
    const fakeChild: any = {
      stdin: { write: () => {}, end: () => {}, destroyed: false },
      stdout: null,
      once: vi.fn(),
      on: vi.fn(),
      kill: vi.fn(),
      pid: 1234,
    };
    (spawn as any).mockReturnValue(fakeChild);

    const a = new Agent({
      name: "a", description: "d", model: "opus",
      permissionMode: "dangerouslySkipPermissions", tools: [], mcp: [], prompt: "system",
    } as any);

    void a.run({ cwd: ".", resume: "s-1", message: "msg" }).catch(() => {});
    await new Promise(r => setTimeout(r, 10));

    const callArgs = (spawn as any).mock.calls[0]?.[1] ?? [];
    expect(callArgs).toContain("-p");
    expect(callArgs).toContain("--resume");
  });
});
