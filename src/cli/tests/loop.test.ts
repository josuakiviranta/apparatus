import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

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
}));

vi.mock("../lib/stream-formatter.js", () => ({
  processLine: vi.fn(() => ({
    output: "",
    nextState: { pendingSubagentIds: new Set(), mainHeaderPrinted: false },
  })),
  initialState: vi.fn(() => ({
    pendingSubagentIds: new Set(),
    mainHeaderPrinted: false,
  })),
}));

// --- Imports after mocks ---

import * as cp from "child_process";
import * as fs from "fs";
import readline from "readline";
import * as clack from "@clack/prompts";
import * as formatter from "../lib/stream-formatter.js";
import { runLoop } from "../lib/loop.js";

// --- Helpers ---

function makeMockChild(exitCode = 0) {
  const stdoutEmitter = new EventEmitter();
  const rlEmitter = new EventEmitter();
  const stdinMock = { end: vi.fn(), pipe: vi.fn(), write: vi.fn() };

  const child = {
    pid: 42,
    stdin: stdinMock,
    stdout: stdoutEmitter,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "exit") setTimeout(() => cb(exitCode, null), 5);
    }),
  };

  // rl.createInterface mock returns an emitter that fires 'close' after 'exit'
  vi.mocked(readline.createInterface).mockReturnValue(rlEmitter as any);
  vi.mocked(cp.spawn).mockReturnValue(child as any);

  return { child, rlEmitter };
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
    const { rlEmitter } = makeMockChild(0);
    mockGitBranch("main");

    const p = runLoop({
      promptFile: "/proj/PROMPT_build.md",
      cwd: "/proj",
      max: 2,
    });

    // Simulate readline close for each iteration
    await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalledTimes(1));
    rlEmitter.emit("close");
    await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalledTimes(2));
    rlEmitter.emit("close");

    await p;

    expect(cp.spawn).toHaveBeenCalledTimes(2);
    expect(clack.outro).toHaveBeenCalled();
  });

  it("feeds each stdout line through processLine and writes output", async () => {
    vi.mocked(formatter.processLine).mockReturnValue({
      output: "→ [read] file.ts\n",
      nextState: { pendingSubagentIds: new Set(), mainHeaderPrinted: true },
    });

    const { rlEmitter } = makeMockChild(0);
    mockGitBranch("main");
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const p = runLoop({
      promptFile: "/proj/PROMPT_build.md",
      cwd: "/proj",
      max: 1,
    });

    await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalledTimes(1));
    rlEmitter.emit("line", '{"type":"assistant","message":{"content":[]}}');
    rlEmitter.emit("close");
    await p;

    expect(formatter.processLine).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith("→ [read] file.ts\n");
    writeSpy.mockRestore();
  });

  it("calls log.warn when claude exits with non-zero code", async () => {
    const { rlEmitter } = makeMockChild(1);
    mockGitBranch("main");

    const p = runLoop({
      promptFile: "/proj/PROMPT_build.md",
      cwd: "/proj",
      max: 1,
    });

    await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalledTimes(1));
    rlEmitter.emit("close");
    await p;

    expect(clack.log.warn).toHaveBeenCalledWith(expect.stringContaining("1"));
  });

  it("calls log.warn when git push fails", async () => {
    const { rlEmitter } = makeMockChild(0);
    // which claude succeeds, git branch succeeds, git push fails
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any) // which claude
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)             // git branch
      .mockReturnValue({ status: 1, stderr: "push failed" } as any);            // git push

    const p = runLoop({
      promptFile: "/proj/PROMPT_build.md",
      cwd: "/proj",
      max: 1,
    });

    await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalledTimes(1));
    rlEmitter.emit("close");
    await p;

    expect(clack.log.warn).toHaveBeenCalled();
  });

  it("prints PID at startup for manual kill", async () => {
    const { rlEmitter } = makeMockChild(0);
    mockGitBranch("main");

    const p = runLoop({
      promptFile: "/proj/PROMPT_build.md",
      cwd: "/proj",
      max: 1,
    });

    await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalledTimes(1));
    rlEmitter.emit("close");
    await p;

    expect(clack.log.step).toHaveBeenCalledWith(
      expect.stringMatching(/PID: \d+/)
    );
  });

  it("retries git push with -u flag on initial failure", async () => {
    const { rlEmitter } = makeMockChild(0);
    // which claude succeeds, git branch succeeds, first git push fails, retry succeeds
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any) // which claude
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)             // git branch
      .mockReturnValueOnce({ status: 1, stderr: "no upstream" } as any)         // git push (fail)
      .mockReturnValueOnce({ status: 0, stderr: "" } as any);                   // git push -u (success)

    const p = runLoop({
      promptFile: "/proj/PROMPT_build.md",
      cwd: "/proj",
      max: 1,
    });

    await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalledTimes(1));
    rlEmitter.emit("close");
    await p;

    // First push: git push origin main
    const pushCalls = vi.mocked(cp.spawnSync).mock.calls.filter(
      (call) => call[0] === "git" && (call[1] as string[])[0] === "push"
    );
    expect(pushCalls).toHaveLength(2);
    expect(pushCalls[0][1]).toEqual(["push", "origin", "main"]);
    expect(pushCalls[1][1]).toEqual(["push", "-u", "origin", "main"]);
  });

  it("warns only after retry also fails", async () => {
    const { rlEmitter } = makeMockChild(0);
    // which claude succeeds, git branch succeeds, both pushes fail
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ stdout: "/usr/bin/claude\n", status: 0 } as any) // which claude
      .mockReturnValueOnce({ stdout: "main\n", status: 0 } as any)             // git branch
      .mockReturnValueOnce({ status: 1, stderr: "no upstream" } as any)         // git push (fail)
      .mockReturnValueOnce({ status: 1, stderr: "still failing" } as any);      // git push -u (fail)

    const p = runLoop({
      promptFile: "/proj/PROMPT_build.md",
      cwd: "/proj",
      max: 1,
    });

    await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalledTimes(1));
    rlEmitter.emit("close");
    await p;

    expect(clack.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("still failing")
    );
  });

  it("spawns claude with correct flags and cwd", async () => {
    const { rlEmitter } = makeMockChild(0);
    mockGitBranch("feature");

    const p = runLoop({
      promptFile: "/proj/PROMPT_build.md",
      cwd: "/proj",
      max: 1,
      model: "sonnet",
    });

    await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalledTimes(1));
    rlEmitter.emit("close");
    await p;

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
});
