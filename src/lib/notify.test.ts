import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { execSyncMock } = vi.hoisted(() => ({ execSyncMock: vi.fn() }));
vi.mock("node:child_process", () => ({ execSync: execSyncMock }));

const PLATFORM = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

describe("notifyUser", () => {
  beforeEach(() => {
    vi.resetModules();
    execSyncMock.mockReset();
  });

  afterEach(() => {
    setPlatform(PLATFORM);
  });

  it("on darwin invokes osascript with title and body", async () => {
    setPlatform("darwin");
    const { notifyUser } = await import("./notify.js");
    notifyUser("apparat", "done");
    expect(execSyncMock).toHaveBeenCalledTimes(1);
    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toBe(`osascript -e 'display notification "done" with title "apparat"'`);
  });

  it("on darwin includes subtitle clause when provided", async () => {
    setPlatform("darwin");
    const { notifyUser } = await import("./notify.js");
    notifyUser("apparat", "done", "verba-extension › harness-loop");
    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toBe(
      `osascript -e 'display notification "done" with title "apparat" subtitle "verba-extension › harness-loop"'`,
    );
  });

  it("on darwin escapes embedded double quotes in title, body, subtitle", async () => {
    setPlatform("darwin");
    const { notifyUser } = await import("./notify.js");
    notifyUser(`a"b`, `c"d`, `e"f`);
    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toBe(
      `osascript -e 'display notification "c\\"d" with title "a\\"b" subtitle "e\\"f"'`,
    );
  });

  it("on darwin swallows execSync errors so callers never see them", async () => {
    setPlatform("darwin");
    execSyncMock.mockImplementation(() => {
      throw new Error("osascript missing");
    });
    const { notifyUser } = await import("./notify.js");
    expect(() => notifyUser("apparat", "done")).not.toThrow();
  });

  it("on linux is a no-op (execSync never called)", async () => {
    setPlatform("linux");
    const { notifyUser } = await import("./notify.js");
    notifyUser("apparat", "done", "x › y");
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("on win32 is a no-op (execSync never called)", async () => {
    setPlatform("win32");
    const { notifyUser } = await import("./notify.js");
    notifyUser("apparat", "done", "x › y");
    expect(execSyncMock).not.toHaveBeenCalled();
  });
});
