import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../attractor/core/engine.js", () => ({
  runPipeline: vi.fn(async () => ({ status: "success", completedNodes: ["start", "done"], context: {} })),
}));
vi.mock("../../attractor/core/graph.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../attractor/core/graph.js")>();
  return { ...actual };
});
vi.mock("../lib/output.js", () => ({
  error: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  stream: vi.fn(async () => {}),
}));
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: () => void) => { if (event === "close") cb(); }),
  })),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "main\n" })),
}));
vi.mock("../components/PipelineApp.js", () => ({
  renderPipelineApp: vi.fn(async () => ({
    callbacks: {
      emit: vi.fn(),
      done: vi.fn(),
    },
    waitUntilExit: vi.fn(async () => {}),
  })),
}));
vi.mock("../lib/assets.js", () => ({}));
vi.mock("../lib/stream-formatter.js", () => ({
  streamEvents: vi.fn(async function* () {}),
  parseStreamJsonEvents: vi.fn(async function* () {}),
}));

import { pipelineRunCommand } from "../commands/pipeline.js";
import * as output from "../lib/output.js";

const UNSAFE_DOT = `digraph g {
  goal="test"
  headless_safe=false
  start [shape=Mdiamond]
  a [agent="implement", prompt="noop"]
  done [shape=Msquare]
  start -> a -> done
}`;

const SAFE_DOT = `digraph g {
  goal="test"
  start [shape=Mdiamond]
  a [agent="implement", prompt="noop"]
  done [shape=Msquare]
  start -> a -> done
}`;

describe("pipelineRunCommand headless safety", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any;
  const origIsTTY = process.stdin.isTTY;
  let dir: string;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    dir = mkdtempSync(join(tmpdir(), "apparat-test-"));
  });

  afterEach(() => {
    exitSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true, configurable: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits with error when headlessSafe=false and not TTY", async () => {
    const dotPath = join(dir, "unsafe.dot");
    writeFileSync(dotPath, UNSAFE_DOT);

    Object.defineProperty(process.stdin, "isTTY", { value: undefined, writable: true, configurable: true });

    await expect(pipelineRunCommand(dotPath, { logsRoot: dir })).rejects.toThrow("process.exit called");
    expect(output.error).toHaveBeenCalledWith(
      expect.stringContaining("headless_safe=false"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does not block when headlessSafe is absent and not TTY", async () => {
    const dotPath = join(dir, "safe.dot");
    writeFileSync(dotPath, SAFE_DOT);

    Object.defineProperty(process.stdin, "isTTY", { value: undefined, writable: true, configurable: true });

    // Should not throw — proceeds to runPipeline (which is mocked).
    // `project` is required by the headless --project guard.
    await pipelineRunCommand(dotPath, { logsRoot: dir, project: dir });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does not block when headlessSafe=false but TTY is present", async () => {
    const dotPath = join(dir, "unsafe.dot");
    writeFileSync(dotPath, UNSAFE_DOT);

    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true, configurable: true });

    await pipelineRunCommand(dotPath, { logsRoot: dir });
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe("pipelineRunCommand headless --project guard", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;
  const origIsTTY = process.stdin.isTTY;
  let dir: string;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as any);
    dir = mkdtempSync(join(tmpdir(), "apparat-test-"));
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true, configurable: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 with a clear message when --project is missing in headless mode", async () => {
    const dotPath = join(dir, "safe.dot");
    writeFileSync(dotPath, SAFE_DOT);

    Object.defineProperty(process.stdin, "isTTY", { value: undefined, writable: true, configurable: true });

    await expect(pipelineRunCommand(dotPath, { logsRoot: dir })).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    const wrote = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(wrote).toMatch(/--project/);
    expect(wrote).toMatch(/headless/i);
  });

  it("does not trigger when --project is supplied in headless mode", async () => {
    const dotPath = join(dir, "safe.dot");
    writeFileSync(dotPath, SAFE_DOT);

    Object.defineProperty(process.stdin, "isTTY", { value: undefined, writable: true, configurable: true });

    await pipelineRunCommand(dotPath, { logsRoot: dir, project: dir });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does not trigger when TTY is present even without --project", async () => {
    const dotPath = join(dir, "safe.dot");
    writeFileSync(dotPath, SAFE_DOT);

    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true, configurable: true });

    await pipelineRunCommand(dotPath, { logsRoot: dir });
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
