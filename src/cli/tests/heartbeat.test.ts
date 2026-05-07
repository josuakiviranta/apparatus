// src/cli/tests/heartbeat.test.ts
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { resolveHeartbeatPipelineArg } from "../commands/heartbeat.js";
import { Command } from "commander";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
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
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "apparat-hb-test-"));
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

describe("apparat heartbeat list", () => {
  it("calls list_tasks and prints table", async () => {
    vi.mocked(request).mockResolvedValue({ type: "tasks", data: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync(["node", "apparat", "heartbeat", "list"]);
    expect(request).toHaveBeenCalledWith("list_tasks");
    logSpy.mockRestore();
  });
});

describe("apparat heartbeat meditate (removed subcommand)", () => {
  it("Commander rejects `heartbeat meditate <folder>` — replacement is `heartbeat pipeline meditate`", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(
      makeProgram().parseAsync([
        "node", "apparat", "heartbeat", "meditate", FIXTURE_DIR, "--every", "5",
      ])
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    errSpy.mockRestore();
    writeSpy.mockRestore();
  });
});

describe("apparat heartbeat stop", () => {
  it("sends stop_task", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok" });
    await makeProgram().parseAsync(["node", "apparat", "heartbeat", "stop", "meditate:proj"]);
    expect(request).toHaveBeenCalledWith("stop_task", { taskId: "meditate:proj" });
  });
});

describe("apparat heartbeat implement", () => {
  it("sends register_task with correct args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "implement:proj" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "apparat", "heartbeat", "implement", FIXTURE_DIR, "--every", "10",
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
      makeProgram().parseAsync(["node", "apparat", "heartbeat", "implement", FIXTURE_DIR])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });

  it("rejects a nonexistent folder before calling the daemon", async () => {
    const s = silence();
    const bogus = join(FIXTURE_DIR, "does-not-exist");
    await expect(
      makeProgram().parseAsync([
        "node", "apparat", "heartbeat", "implement", bogus, "--every", "10",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    const combined = s.errSpy.mock.calls.flat().join(" ");
    expect(combined).toContain(bogus);
    s.restore();
  });
});

describe("apparat heartbeat pipeline", () => {
  it("sends register_task with run subcommand args and computed id", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "apparat", "heartbeat", "pipeline", FIXTURE_DOT,
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
        "node", "apparat", "heartbeat", "pipeline", FIXTURE_DOT,
        "--project", FIXTURE_DIR,
      ])
    ).rejects.toThrow();
    errSpy.mockRestore();
  });

  it("works without --project (pipeline handles default)", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "apparat", "heartbeat", "pipeline", FIXTURE_DOT, "--every", "30",
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
        "node", "apparat", "heartbeat", "pipeline", bogus, "--every", "30",
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
        "node", "apparat", "heartbeat", "pipeline", FIXTURE_DOT,
        "--project", bogus, "--every", "30",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    const combined = s.errSpy.mock.calls.flat().join(" ");
    expect(combined).toContain(bogus);
    s.restore();
  });

  it("forwards a single --var key=value into register_task args", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "apparat", "heartbeat", "pipeline", FIXTURE_DOT,
      "--project", FIXTURE_DIR, "--every", "30",
      "--var", "steer=focus on logging",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", {
      id: "pipeline:smoke",
      command: "pipeline",
      args: ["run", FIXTURE_DOT, "--project", FIXTURE_DIR, "--var", "steer=focus on logging"],
      interval: 30,
    });
    logSpy.mockRestore();
  });

  it("accumulates multiple --var flags and forwards each as its own pair", async () => {
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:smoke" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "apparat", "heartbeat", "pipeline", FIXTURE_DOT,
      "--project", FIXTURE_DIR, "--every", "30",
      "--var", "steer=focus on logging",
      "--var", "scope=src/cli",
    ]);
    const call = vi.mocked(request).mock.calls[0];
    expect(call[0]).toBe("register_task");
    const payload = call[1] as { args: string[] };
    expect(payload.args).toEqual([
      "run", FIXTURE_DOT, "--project", FIXTURE_DIR,
      "--var", "steer=focus on logging",
      "--var", "scope=src/cli",
    ]);
    logSpy.mockRestore();
  });
});

describe("apparat heartbeat pipeline id derivation (folder-form pipelines)", () => {
  it("uses the parent folder name as id when the dotfile basename is `pipeline.dot`", async () => {
    const folderDot = join(FIXTURE_DIR, "janitor", "pipeline.dot");
    mkdirSync(join(FIXTURE_DIR, "janitor"), { recursive: true });
    writeFileSync(folderDot, "digraph { a -> b; }\n");

    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:janitor" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "apparat", "heartbeat", "pipeline", folderDot,
      "--project", FIXTURE_DIR, "--every", "40",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", expect.objectContaining({
      id: "pipeline:janitor",
    }));
    logSpy.mockRestore();
  });
});

describe("apparat heartbeat pipeline preflight: missing --project when $project referenced", () => {
  it("rejects registration when pipeline references $project but --project is omitted", async () => {
    const dot = join(FIXTURE_DIR, "needs-project.dot");
    writeFileSync(dot, `
      digraph p {
        start [shape=Mdiamond]
        run [type="tool", cwd="$project", toolCommand="echo $project"]
        done [shape=Msquare]
        start -> run -> done
      }
    `);
    const s = silence();
    await expect(
      makeProgram().parseAsync([
        "node", "apparat", "heartbeat", "pipeline", dot, "--every", "40",
      ])
    ).rejects.toThrow(/exit:1/);
    expect(request).not.toHaveBeenCalled();
    const combined = s.errSpy.mock.calls.flat().join(" ");
    expect(combined).toMatch(/\$project/);
    expect(combined).toMatch(/--project/);
    s.restore();
  });

  it("registers when pipeline references $project AND --project is provided", async () => {
    const dot = join(FIXTURE_DIR, "needs-project-ok.dot");
    writeFileSync(dot, `
      digraph p {
        start [shape=Mdiamond]
        run [type="tool", cwd="$project", toolCommand="echo $project"]
        done [shape=Msquare]
        start -> run -> done
      }
    `);
    vi.mocked(request).mockResolvedValue({ type: "ok", taskId: "pipeline:needs-project-ok" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeProgram().parseAsync([
      "node", "apparat", "heartbeat", "pipeline", dot,
      "--project", FIXTURE_DIR, "--every", "40",
    ]);
    expect(request).toHaveBeenCalledWith("register_task", expect.objectContaining({
      command: "pipeline",
      args: ["run", dot, "--project", FIXTURE_DIR],
    }));
    logSpy.mockRestore();
  });
});

describe("resolveHeartbeatPipelineArg", () => {
  const repoRoot = resolveFn(__dirname, "../../..");

  it("routes shorthand `janitor` through the resolver to the bundled dotfile", () => {
    const dotPath = resolveHeartbeatPipelineArg("janitor", repoRoot);
    expect(dotPath.endsWith("janitor/pipeline.dot")).toBe(true);
  });

  it("treats `./my.dot` as a literal path", () => {
    const cwd = process.cwd();
    expect(resolveHeartbeatPipelineArg("./my.dot", cwd)).toBe(resolveFn(cwd, "./my.dot"));
  });
});
