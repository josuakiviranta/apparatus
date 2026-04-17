import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../output.js", () => ({
  stream: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
}));

vi.mock("../stream-formatter.js", () => ({
  streamEvents: vi.fn((_stdout, opts: { onSessionId?: (id: string) => void } | undefined) => {
    // Default: emit a fake session id so happy-path tests can capture it.
    // Tests that need a different behavior override this mock.
    if (opts?.onSessionId) opts.onSessionId("sess-default");
    return (async function* () {})();
  }),
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    stdout: {} as NodeJS.ReadableStream,
    stderr: {} as NodeJS.ReadableStream,
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === "close") cb(0);
    }),
  })),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

import { runTwoPhaseClaudeSession } from "../session.js";
import * as childProcess from "child_process";
import { streamEvents } from "../stream-formatter.js";

describe("runTwoPhaseClaudeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (streamEvents as ReturnType<typeof vi.fn>).mockImplementation(
      (_stdout, opts: { onSessionId?: (id: string) => void } | undefined) => {
        if (opts?.onSessionId) opts.onSessionId("sess-default");
        return (async function* () {})();
      },
    );
    (childProcess.spawn as ReturnType<typeof vi.fn>).mockReturnValue({
      stdout: {} as NodeJS.ReadableStream,
      stderr: {} as NodeJS.ReadableStream,
      on: vi.fn((event: string, cb: (code: number) => void) => {
        if (event === "close") cb(0);
      }),
    });
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0 });
  });

  it("happy path: spawns phase-1 with trigger, then resumes phase-2 with --resume <id>", async () => {
    (streamEvents as ReturnType<typeof vi.fn>).mockImplementation(
      (_stdout, opts: { onSessionId?: (id: string) => void } | undefined) => {
        if (opts?.onSessionId) opts.onSessionId("abc123");
        return (async function* () {})();
      },
    );

    const result = await runTwoPhaseClaudeSession({
      cwd: "/proj",
      trigger: "do the thing",
    });

    const spawnArgs = (childProcess.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(spawnArgs[0]).toBe("claude");
    expect(spawnArgs[1]).toEqual([
      "-p",
      "do the thing",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
    ]);
    expect(spawnArgs[2]).toMatchObject({ cwd: "/proj" });

    const resumeArgs = (childProcess.spawnSync as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(resumeArgs[0]).toBe("claude");
    expect(resumeArgs[1]).toEqual(["--dangerously-skip-permissions", "--resume", "abc123"]);
    expect(resumeArgs[2]).toMatchObject({ cwd: "/proj", stdio: "inherit" });

    expect(result).toEqual({ sessionId: "abc123", exitCode: 0 });
  });

  it("phase-1 fails, phase-2 skipped", async () => {
    (childProcess.spawn as ReturnType<typeof vi.fn>).mockReturnValue({
      stdout: {} as NodeJS.ReadableStream,
      stderr: {} as NodeJS.ReadableStream,
      on: vi.fn((event: string, cb: (code: number) => void) => {
        if (event === "close") cb(7);
      }),
    });
    (streamEvents as ReturnType<typeof vi.fn>).mockImplementation(
      () => (async function* () {})(),
    );

    const result = await runTwoPhaseClaudeSession({
      cwd: "/proj",
      trigger: "x",
    });

    expect(childProcess.spawnSync).not.toHaveBeenCalled();
    expect(result).toEqual({ sessionId: null, exitCode: 7 });
  });

  it("no session id captured: phase-2 invoked without --resume", async () => {
    (streamEvents as ReturnType<typeof vi.fn>).mockImplementation(
      () => (async function* () {})(),
    );

    const result = await runTwoPhaseClaudeSession({
      cwd: "/proj",
      trigger: "x",
    });

    const resumeArgs = (childProcess.spawnSync as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(resumeArgs).toEqual(["--dangerously-skip-permissions"]);
    expect(result).toEqual({ sessionId: null, exitCode: 0 });
  });

  it("phase-2 non-zero exit propagates as exitCode", async () => {
    (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 2 });

    const result = await runTwoPhaseClaudeSession({
      cwd: "/proj",
      trigger: "x",
    });

    expect(result.exitCode).toBe(2);
  });
});
