import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { Readable, Writable } from "stream";

// Hoisted mock — same pattern as existing agent.test.ts
const { mockSpawn } = vi.hoisted(() => {
  return { mockSpawn: vi.fn() };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: any[]) => {
      const override = mockSpawn();
      if (override) return override;
      return actual.spawn(...(args as Parameters<typeof actual.spawn>));
    },
  };
});

import { Agent, type AgentConfig } from "../lib/agent.js";
import { Session } from "../lib/session.js";

function makeFakeChild(stdoutLines: string[] = []) {
  const child = new EventEmitter() as any;
  child.pid = 12345;

  const stdinWrites: string[] = [];
  child.stdin = new Writable({
    write(chunk: any, _enc: any, cb: any) {
      stdinWrites.push(chunk.toString());
      cb();
    },
  });
  (child.stdin as any).__writes = stdinWrites;

  child.stdout = new Readable({
    read() {
      const next = stdoutLines.shift();
      if (next !== undefined) this.push(next + "\n");
      else this.push(null);
    },
  });

  child.kill = vi.fn();
  return child;
}

const baseConfig: AgentConfig = {
  name: "chatter",
  description: "",
  model: "opus",
  permissionMode: "dangerouslySkipPermissions",
  tools: [],
  mcp: [],
  prompt: "ignored for runInteractive",
};

describe("Agent.buildInteractiveArgs", () => {
  it("includes -p, stream-json input/output, --verbose, --append-system-prompt, --session-id", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildInteractiveArgs({
      systemPrompt: "you are helpful",
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    expect(args).toContain("-p");
    expect(args).toContain("--input-format");
    expect(args[args.indexOf("--input-format") + 1]).toBe("stream-json");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--append-system-prompt");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe("you are helpful");
    expect(args).toContain("--session-id");
    expect(args[args.indexOf("--session-id") + 1]).toBe("11111111-2222-3333-4444-555555555555");
  });
});

describe("Agent.runInteractive — ChildHandle behavior", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("submit(text) writes one NDJSON line to stdin", async () => {
    const child = makeFakeChild([]);
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const session = new Session("test-uuid");
    const handle = agent.runInteractive({
      session,
      systemPrompt: "test",
      cwd: "/tmp",
    });

    await handle.submit("hello");
    const writes = (child.stdin as any).__writes as string[];
    expect(writes.length).toBe(1);
    const parsed = JSON.parse(writes[0].trim());
    expect(parsed).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
  });

  it("events iterator yields parsed events from stdout lines", async () => {
    const initLine = JSON.stringify({ type: "system", subtype: "init", session_id: "s1" });
    const assistantLine = JSON.stringify({
      type: "assistant",
      message: { id: "m1", content: [{ type: "text", text: "hi" }] },
    });
    const resultLine = JSON.stringify({
      type: "result",
      stop_reason: "end_turn",
      result: "hi",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const child = makeFakeChild([initLine, assistantLine, resultLine]);
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const session = new Session("s1");
    const handle = agent.runInteractive({ session, systemPrompt: "p", cwd: "/tmp" });

    const collected: any[] = [];
    for await (const ev of handle.events) {
      collected.push(ev);
      if (ev.type === "result") break;
    }

    expect(collected.some((e) => e.type === "system")).toBe(true);
    expect(collected.some((e) => e.type === "assistant_delta")).toBe(true);
    expect(collected.some((e) => e.type === "result")).toBe(true);
  });

  it("end() calls stdin.end and resolves when child exits", async () => {
    const child = makeFakeChild([]);
    const endSpy = vi.spyOn(child.stdin, "end");
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const handle = agent.runInteractive({
      session: new Session("s1"),
      systemPrompt: "p",
      cwd: "/tmp",
    });

    const endPromise = handle.end();
    child.emit("close", 0);
    await endPromise;
    expect(endSpy).toHaveBeenCalled();
  });

  it("kill() sends SIGTERM, then SIGKILL after 3s if child still alive", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild([]);
      mockSpawn.mockReturnValue(child);

      const agent = new Agent(baseConfig);
      const handle = agent.runInteractive({
        session: new Session("s1"),
        systemPrompt: "p",
        cwd: "/tmp",
      });

      const killPromise = handle.kill("SIGTERM");
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      // Advance past the 3-second escalation timer
      vi.advanceTimersByTime(3100);
      // Simulate the child eventually dying from SIGKILL
      child.emit("close", null);
      await killPromise;

      // SIGKILL should have been sent after the timer
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("submit after end rejects", async () => {
    const child = makeFakeChild([]);
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const handle = agent.runInteractive({
      session: new Session("s1"),
      systemPrompt: "p",
      cwd: "/tmp",
    });

    const endP = handle.end();
    child.emit("close", 0);
    await endP;

    await expect(handle.submit("late")).rejects.toThrow(/closed|ended|not writable/i);
  });

  it("sessionId is exposed on the handle", () => {
    const child = makeFakeChild([]);
    mockSpawn.mockReturnValue(child);
    const agent = new Agent(baseConfig);
    const handle = agent.runInteractive({
      session: new Session("session-uuid-xyz"),
      systemPrompt: "p",
      cwd: "/tmp",
    });
    expect(handle.sessionId).toBe("session-uuid-xyz");
  });
});
