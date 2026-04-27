import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "child_process";
import { RalphMeditateHandler } from "../handlers/ralph-meditate.js";
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

  it("forwards --var steer=... when node has steer property", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphMeditateHandler();
    const node: Node = { id: "med", steer: "focus on security" };
    await h.execute(node, baseCtx(), makeContext());
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toContain("--var");
    expect(args).toContain("steer=focus on security");
  });

  it("omits --var when node has no steer property", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphMeditateHandler();
    await h.execute({ id: "med" }, baseCtx(), makeContext());
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).not.toContain("--var");
  });

  it("omits --var when steer is not a string", async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as any);
    const h = new RalphMeditateHandler();
    await h.execute({ id: "med", steer: 42 } as any, baseCtx(), makeContext());
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).not.toContain("--var");
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

