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

vi.mock("../lib/output.js", () => ({
  header: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  error: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  spinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  stream: vi.fn(async (iter: AsyncIterable<unknown>) => {
    for await (const _ of iter) { /* consume */ }
  }),
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
  streamEvents: vi.fn(async function* () { /* yields nothing */ }),
}));

// --- Imports after mocks ---

import * as cp from "child_process";
import * as fs from "fs";
import readline from "readline";
import * as out from "../lib/output.js";
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

  it("throws if promptFile does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await expect(
      runLoop({ promptFile: "/no/such/file.md", cwd: "/proj" })
    ).rejects.toThrow("Prompt file not found");
    expect(out.error).toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it("throws if claude is not in PATH", async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({ stdout: "", status: 1 } as any);
    await expect(
      runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj" })
    ).rejects.toThrow("claude CLI not found");
    expect(out.error).toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it("runs exactly max iterations then calls info()", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 2 });
    expect(cp.spawn).toHaveBeenCalledTimes(2);
    expect(out.info).toHaveBeenCalled();
  });

  it("calls streamEvents with child.stdout and passes result to output.stream()", async () => {
    makeMockChild(0);
    mockGitBranch("main");

    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });

    expect(formatter.streamEvents).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ onSessionId: expect.any(Function) }));
    expect(out.stream).toHaveBeenCalledTimes(1);
  });

  it("calls warn when claude exits with non-zero code", async () => {
    makeMockChild(1);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(out.warn).toHaveBeenCalledWith(expect.stringContaining("1"));
  });

  it("calls warn when git push fails", async () => {
    makeMockChild(0);
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any)
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)
      .mockReturnValue({ status: 1, stderr: "push failed" } as any);
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(out.warn).toHaveBeenCalled();
  });

  it("calls header at startup with mode and project", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(out.header).toHaveBeenCalledWith(expect.objectContaining({ mode: "implement", project: "/proj", pid: process.pid }));
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
    expect(out.warn).toHaveBeenCalledWith(expect.stringContaining("still failing"));
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

  it("calls output.stream once per loop iteration", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 3 });
    expect(out.stream).toHaveBeenCalledTimes(3);
  });

  it("returns exitReason=maxReached when max iterations hit", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    const result = await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(result.exitReason).toBe("maxReached");
    expect(result.iterations).toBe(1);
  });

  it("returns exitReason=aborted when signal is pre-aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", signal: ac.signal });
    expect(result.exitReason).toBe("aborted");
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});
