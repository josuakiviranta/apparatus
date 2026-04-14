import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "child_process";
import { RalphMeditateHandler } from "../handlers/ralph-meditate.js";
import { RalphScenariosHandler } from "../handlers/ralph-scenarios.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";
import type { Node, PipelineContext } from "../types.js";

const mockSpawnSync = vi.mocked(spawnSync);

const baseCtx = (): PipelineContext => ({ values: {} });

function makeContext(overrides: Partial<HandlerExecutionContext> = {}): HandlerExecutionContext {
  return { logsRoot: "/tmp", cwd: "/projects/my-app", dotDir: "/tmp", outgoingLabels: [], completedNodes: [], nodeRetries: {}, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RalphMeditateHandler", () => {
  it("returns success when ralph meditate exits 0", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphMeditateHandler();
    const outcome = await h.execute({ id: "med" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
  });

  it("returns fail when ralph meditate exits non-zero", async () => {
    mockSpawnSync.mockReturnValue({ status: 1 } as any);
    const h = new RalphMeditateHandler();
    const outcome = await h.execute({ id: "med" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("non-zero");
  });

  it("passes cwd from meta to spawn args", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphMeditateHandler();
    await h.execute({ id: "med" }, baseCtx(), makeContext({ cwd: "/my/project" }));
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toContain("meditate");
    expect(args).toContain("/my/project");
  });

  it("forwards --steer flag when node has steer property", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphMeditateHandler();
    const node: Node = { id: "med", steer: "focus on security" };
    await h.execute(node, baseCtx(), makeContext());
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toContain("--steer");
    expect(args).toContain("focus on security");
  });

  it("omits --steer flag when node has no steer property", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphMeditateHandler();
    await h.execute({ id: "med" }, baseCtx(), makeContext());
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).not.toContain("--steer");
  });

  it("omits --steer flag when steer is not a string", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphMeditateHandler();
    await h.execute({ id: "med", steer: 42 } as any, baseCtx(), makeContext());
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).not.toContain("--steer");
  });

  it("uses process.execPath and process.argv[1] for spawn", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphMeditateHandler();
    await h.execute({ id: "med" }, baseCtx(), makeContext());
    expect(mockSpawnSync.mock.calls[0][0]).toBe(process.execPath);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args[0]).toBe(process.argv[1]);
  });
});

describe("RalphScenariosHandler", () => {
  it("returns success and scenarios.passed=true when exit 0", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphScenariosHandler();
    const outcome = await h.execute({ id: "sc" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["scenarios.passed"]).toBe("true");
  });

  it("returns fail and scenarios.passed=false when exit non-zero", async () => {
    mockSpawnSync.mockReturnValue({ status: 1 } as any);
    const h = new RalphScenariosHandler();
    const outcome = await h.execute({ id: "sc" }, baseCtx(), makeContext());
    expect(outcome.status).toBe("fail");
    expect(outcome.contextUpdates?.["scenarios.passed"]).toBe("false");
  });

  it("passes cwd and run-scenarios in spawn args", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphScenariosHandler();
    await h.execute({ id: "sc" }, baseCtx(), makeContext({ cwd: "/test/proj" }));
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toContain("/test/proj");
    expect(args).toContain("run-scenarios");
  });

  it("uses inherited stdio", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphScenariosHandler();
    await h.execute({ id: "sc" }, baseCtx(), makeContext());
    const opts = mockSpawnSync.mock.calls[0][2] as any;
    expect(opts.stdio).toBe("inherit");
  });
});
