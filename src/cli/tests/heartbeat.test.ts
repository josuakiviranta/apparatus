// src/cli/tests/heartbeat.test.ts
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Command } from "commander";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve as resolveFn } from "path";
import { registerHeartbeatCommand } from "../commands/heartbeat";

// Mock daemon-client
vi.mock("../../lib/daemon-client", () => ({
  request: vi.fn(),
  stream: vi.fn(),
}));

import { request } from "../../lib/daemon-client";

// Real fixture directory that exists on disk — used by tests that exercise
// the happy path of commands that validate the folder exists.
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "ralph-hb-test-"));
const FIXTURE_DOT = join(FIXTURE_DIR, "smoke.dot");
writeFileSync(FIXTURE_DOT, 'digraph { a -> b; }\n');

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevent process.exit in tests
  registerHeartbeatCommand(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
});

function silence() {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as any);
  return { errSpy, logSpy, exitSpy, restore() {
    errSpy.mockRestore();
    logSpy.mockRestore();
    exitSpy.mockRestore();
  }};
}

describe("ralph heartbeat list", () => {
  it("calls list_tasks and prints table", async () => {
    vi.mocked(request).mockResolvedValue({ type: "tasks", data: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync(["node", "ralph", "heartbeat", "list"]);
    expect(request).toHaveBeenCalledWith("list_tasks");
    logSpy.mockRestore();
  });
});

describe("ralph heartbeat meditate", () => {
  it("sends register_task with correct args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "meditate:proj" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "meditate", FIXTURE_DIR, "--every", "5",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      command: "meditate",
      args: [FIXTURE_DIR],
      interval: 5,
    });
    logSpy.mockRestore();
  });

  it("errors when --every is missing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      makeProgram().parseAsync(["node", "ralph", "heartbeat", "meditate", FIXTURE_DIR])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });

  it("rejects a nonexistent folder before calling the daemon", async () => {
    const s = silence();
    const bogus = join(FIXTURE_DIR, "does-not-exist");
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "meditate", bogus, "--every", "5",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    const combined = s.errSpy.mock.calls.flat().join(" ");
    expect(combined).toContain(bogus);
    s.restore();
  });

  it("rejects the double-join case and reports both original arg and resolved path", async () => {
    // Reproduces the original bug: user inside /.../ralph-cli runs
    // `ralph heartbeat meditate ralph-cli` and resolve() produces
    // /.../ralph-cli/ralph-cli which does not exist. A relative arg that
    // does not exist under the current cwd triggers the same code path.
    // (vitest workers disallow process.chdir so we use the test runner's cwd.)
    const s = silence();
    const relArg = "this-folder-should-definitely-not-exist-zzz";
    const expectedAbs = resolveFn(relArg);
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "meditate", relArg, "--every", "5",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    const combined = s.errSpy.mock.calls.flat().join(" ");
    expect(combined).toContain(expectedAbs);   // shows the resolved absolute path
    expect(combined).toContain(relArg);        // shows the original arg
    expect(combined).toContain(process.cwd()); // and the cwd for diagnosis
    s.restore();
  });

  it("rejects when the folder arg points at a file instead of a directory", async () => {
    const s = silence();
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "meditate", FIXTURE_DOT, "--every", "5",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    s.restore();
  });
});

describe("ralph heartbeat meditate --steer", () => {
  it("includes --steer in args when provided", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "meditate:test" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "meditate", FIXTURE_DIR,
      "--every", "30", "--steer", "focus on auth",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      command: "meditate",
      args: [FIXTURE_DIR, "--steer", "focus on auth"],
      interval: 30,
    });
    logSpy.mockRestore();
  });

  it("omits --steer from args when not provided", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "meditate:test" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "meditate", FIXTURE_DIR, "--every", "30",
    ]);
    const callArgs = (vi.mocked(request).mock.calls[0][1] as any).args as string[];
    expect(callArgs).not.toContain("--steer");
    logSpy.mockRestore();
  });
});

describe("ralph heartbeat stop", () => {
  it("sends stop_task", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok" });
    await makeProgram().parseAsync(["node", "ralph", "heartbeat", "stop", "meditate:proj"]);
    expect(request).toHaveBeenCalledWith("stop_task", { taskId: "meditate:proj" });
  });
});

describe("ralph heartbeat implement", () => {
  it("sends register_task with correct args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "implement:proj" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "implement", FIXTURE_DIR, "--every", "10",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      command: "implement",
      args: [FIXTURE_DIR],
      interval: 10,
    });
    logSpy.mockRestore();
  });

  it("errors when --every is missing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      makeProgram().parseAsync(["node", "ralph", "heartbeat", "implement", FIXTURE_DIR])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });

  it("rejects a nonexistent folder before calling the daemon", async () => {
    const s = silence();
    const bogus = join(FIXTURE_DIR, "does-not-exist");
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "implement", bogus, "--every", "10",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    const combined = s.errSpy.mock.calls.flat().join(" ");
    expect(combined).toContain(bogus);
    s.restore();
  });
});

describe("ralph heartbeat run-scenarios", () => {
  it("sends register_task with correct args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "run-scenarios:proj" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "run-scenarios", FIXTURE_DIR, "--every", "60",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      command: "run-scenarios",
      args: [FIXTURE_DIR],
      interval: 60,
    });
    logSpy.mockRestore();
  });

  it("rejects a nonexistent folder before calling the daemon", async () => {
    const s = silence();
    const bogus = join(FIXTURE_DIR, "does-not-exist");
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "run-scenarios", bogus, "--every", "60",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    s.restore();
  });
});

describe("ralph heartbeat pipeline", () => {
  it("sends register_task with run subcommand args and computed id", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "pipeline", FIXTURE_DOT,
      "--project", FIXTURE_DIR, "--every", "30",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      id: "pipeline:smoke",
      command: "pipeline",
      args: ["run", FIXTURE_DOT, "--project", FIXTURE_DIR],
      interval: 30,
    });
    logSpy.mockRestore();
  });

  it("errors when --every is missing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "pipeline", FIXTURE_DOT,
        "--project", FIXTURE_DIR,
      ])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });

  it("works without --project (pipeline handles default)", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "ralph", "heartbeat", "pipeline", FIXTURE_DOT, "--every", "30",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", expect.objectContaining({
      command: "pipeline",
      id: "pipeline:smoke",
    }));
    logSpy.mockRestore();
  });

  it("rejects a nonexistent dotfile before calling the daemon", async () => {
    const s = silence();
    const bogus = join(FIXTURE_DIR, "does-not-exist.dot");
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "pipeline", bogus, "--every", "30",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    const combined = s.errSpy.mock.calls.flat().join(" ");
    expect(combined).toContain(bogus);
    s.restore();
  });

  it("rejects a nonexistent --project folder before calling the daemon", async () => {
    const s = silence();
    const bogus = join(FIXTURE_DIR, "missing-project");
    await expect(
      makeProgram().parseAsync([
        "node", "ralph", "heartbeat", "pipeline", FIXTURE_DOT,
        "--project", bogus, "--every", "30",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    const combined = s.errSpy.mock.calls.flat().join(" ");
    expect(combined).toContain(bogus);
    s.restore();
  });
});
