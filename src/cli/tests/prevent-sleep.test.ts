import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const PLATFORM = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

describe("preventSleep", () => {
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    spawnMock.mockReturnValue({ unref: vi.fn(), on: vi.fn() });
  });

  afterEach(() => {
    setPlatform(PLATFORM);
  });

  it("spawns caffeinate -is -w <pid> on darwin", async () => {
    setPlatform("darwin");
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe("caffeinate");
    expect(args).toEqual(["-is", "-w", String(process.pid)]);
    expect(opts).toMatchObject({ stdio: "ignore", detached: true });
  });

  it("calls unref() on the spawned child on darwin", async () => {
    setPlatform("darwin");
    const unref = vi.fn();
    spawnMock.mockReturnValue({ unref, on: vi.fn() });
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it("attaches an error handler so an absent caffeinate does not crash the engine", async () => {
    setPlatform("darwin");
    const on = vi.fn();
    spawnMock.mockReturnValue({ unref: vi.fn(), on });
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("is a silent no-op on linux", async () => {
    setPlatform("linux");
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("is a silent no-op on win32", async () => {
    setPlatform("win32");
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
