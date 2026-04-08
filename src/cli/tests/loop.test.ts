import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events"; // still used for child.stdout mock

// --- Mocks (must be hoisted before imports) ---

vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock("readline", () => ({
  default: { createInterface: vi.fn() },
  createInterface: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  log: { warn: vi.fn(), step: vi.fn() },
  note: vi.fn(),
  stream: {
    message: vi.fn(async (gen: AsyncIterable<string>) => {
      for await (const _ of gen) {
        /* no-op */
      }
    }),
  },
}));

vi.mock("../lib/stream-formatter.js", () => ({
  processLine: vi.fn(() => ({
    events: [],
    nextState: { pendingSubagentIds: new Set(), subagentBuffers: new Map(), subagentDescriptions: new Map(), mainAgentOpen: false, lastMainCtxTotal: 0 },
  })),
  initialState: vi.fn(() => ({
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainAgentOpen: false,
    lastMainCtxTotal: 0,
  })),
  flushState: vi.fn(() => []),
  serializeEvent: vi.fn((ev: any) => {
    switch (ev.type) {
      case "main_agent_open": return "\u25b6\u25b6\u25b6 MAIN AGENT\n";
      case "main_agent_close": return "\u25c0\u25c0\u25c0 MAIN AGENT\n\n";
      case "subagent_open": return `\u25b6 SUBAGENT: ${ev.description}\n`;
      case "subagent_close": return "\u25c0 SUBAGENT\n";
      case "text": return (ev.indented ? "  " : "") + ev.content + "\n";
      case "tool": return (ev.indented ? "  " : "") + `\u2192 [${ev.name}] ${ev.label}\n`;
      case "ctx": return `\u25c8 ctx: ${ev.tokens.toLocaleString("en-US")} tokens\n`;
      default: return "";
    }
  }),
}));

// --- Imports after mocks ---

import * as cp from "child_process";
import * as fs from "fs";
import readline from "readline";
import * as clack from "@clack/prompts";
import * as formatter from "../lib/stream-formatter.js";
import { runLoop } from "../lib/loop.js";

// --- Helpers ---

function makeMockChild(exitCode = 0, lines: string[] = []) {
  const stdoutEmitter = new EventEmitter();
  const stdinMock = { end: vi.fn(), pipe: vi.fn(), write: vi.fn() };

  const child = {
    pid: 42,
    stdin: stdinMock,
    stdout: stdoutEmitter,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "exit") setTimeout(() => cb(exitCode, null), 5);
    }),
  };

  const rlMock = {
    [Symbol.asyncIterator]: async function* () {
      for (const line of lines) {
        yield line;
      }
    },
  };

  vi.mocked(readline.createInterface).mockReturnValue(rlMock as any);
  vi.mocked(cp.spawn).mockReturnValue(child as any);

  return { child };
}

function mockGitBranch(branch = "main") {
  vi.mocked(cp.spawnSync)
    .mockReturnValueOnce({ stdout: branch + "\n", status: 0 } as any) // git branch
    .mockReturnValue({ stdout: "", status: 0 } as any); // git push
}

// --- Tests ---

describe("runLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.createReadStream).mockReturnValue({
      pipe: vi.fn(),
    } as any);
    // Default: claude found
    vi.mocked(cp.spawnSync).mockReturnValue({ stdout: "/usr/bin/claude\n", status: 0 } as any);
  });

  it("calls cancel() and does not loop if promptFile does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    await expect(
      runLoop({ promptFile: "/no/such/file.md", cwd: "/proj" })
    ).rejects.toThrow("process.exit");
    expect(clack.cancel).toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("calls cancel() and does not loop if claude is not in PATH", async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({ stdout: "", status: 1 } as any);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    await expect(
      runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj" })
    ).rejects.toThrow("process.exit");
    expect(clack.cancel).toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("runs exactly max iterations then calls outro()", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 2 });
    expect(cp.spawn).toHaveBeenCalledTimes(2);
    expect(clack.outro).toHaveBeenCalled();
  });

  it("calls processLine for each line and passes generator to stream.message", async () => {
    const testLine = '{"type":"assistant","message":{"content":[]}}';
    vi.mocked(formatter.processLine).mockReturnValue({
      events: [{ type: "tool", name: "read", label: "file.ts" }],
      nextState: { pendingSubagentIds: new Set(), subagentBuffers: new Map(), subagentDescriptions: new Map(), mainAgentOpen: false, lastMainCtxTotal: 0 },
    } as any);

    makeMockChild(0, [testLine]);
    mockGitBranch("main");

    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });

    expect(formatter.processLine).toHaveBeenCalledWith(testLine, expect.any(Object));
    expect((clack as any).stream.message).toHaveBeenCalledTimes(1);
  });

  it("calls log.warn when claude exits with non-zero code", async () => {
    makeMockChild(1);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(clack.log.warn).toHaveBeenCalledWith(expect.stringContaining("1"));
  });

  it("calls log.warn when git push fails", async () => {
    makeMockChild(0);
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any)
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)
      .mockReturnValue({ status: 1, stderr: "push failed" } as any);
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(clack.log.warn).toHaveBeenCalled();
  });

  it("prints PID at startup for manual kill", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(clack.log.step).toHaveBeenCalledWith(expect.stringMatching(/PID: \d+/));
  });

  it("retries git push with -u flag on initial failure", async () => {
    makeMockChild(0);
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any)
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)
      .mockReturnValueOnce({ status: 1, stderr: "no upstream" } as any)
      .mockReturnValueOnce({ status: 0, stderr: "" } as any);
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    const pushCalls = vi.mocked(cp.spawnSync).mock.calls.filter(
      (call) => call[0] === "git" && (call[1] as string[])[0] === "push"
    );
    expect(pushCalls).toHaveLength(2);
    expect(pushCalls[0][1]).toEqual(["push", "origin", "main"]);
    expect(pushCalls[1][1]).toEqual(["push", "-u", "origin", "main"]);
  });

  it("warns only after retry also fails", async () => {
    makeMockChild(0);
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any)
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)
      .mockReturnValueOnce({ status: 1, stderr: "no upstream" } as any)
      .mockReturnValueOnce({ status: 1, stderr: "still failing" } as any);
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(clack.log.warn).toHaveBeenCalledWith(expect.stringContaining("still failing"));
  });

  it("spawns claude with correct flags and cwd", async () => {
    makeMockChild(0);
    mockGitBranch("feature");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1, model: "sonnet" });
    expect(cp.spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "-p",
        "--dangerously-skip-permissions",
        "--output-format=stream-json",
        "--model",
        "sonnet",
      ]),
      expect.objectContaining({ cwd: "/proj", detached: true })
    );
  });

  it("calls stream.message once per loop iteration", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 3 });
    expect((clack as any).stream.message).toHaveBeenCalledTimes(3);
  });
});
