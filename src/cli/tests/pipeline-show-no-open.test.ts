import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}));

vi.mock("child_process", () => ({ spawn: spawnMock }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../lib/output.js", () => ({
  error: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  stream: vi.fn(async () => {}),
}));
vi.mock("@hpcc-js/wasm-graphviz", () => ({
  Graphviz: {
    load: vi.fn(async () => ({
      dot: () => `<svg><!-- mocked --></svg>`,
    })),
  },
}));

import { pipelineShowCommand } from "../commands/pipeline.js";

const okDot = `digraph g {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  start -> done
}`;

describe("pipeline show auto-open behaviour", () => {
  let dir: string;
  beforeEach(() => {
    spawnMock.mockClear();
    dir = mkdtempSync(join(tmpdir(), "apparat-show-open-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("does not spawn opener when called from a non-TTY context with default opts", async () => {
    const dotFile = join(dir, "ok.dot");
    writeFileSync(dotFile, okDot);
    const code = await pipelineShowCommand(dotFile, {});
    expect(code).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("does not spawn opener when --no-open is explicit", async () => {
    const dotFile = join(dir, "ok.dot");
    writeFileSync(dotFile, okDot);
    const code = await pipelineShowCommand(dotFile, { open: false });
    expect(code).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns the platform-appropriate opener when --open is explicit", async () => {
    const dotFile = join(dir, "ok.dot");
    writeFileSync(dotFile, okDot);
    const code = await pipelineShowCommand(dotFile, { open: true });
    expect(code).toBe(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin] = spawnMock.mock.calls[0] as [string, ...unknown[]];
    if (process.platform === "darwin") expect(bin).toBe("open");
    else if (process.platform === "win32") expect(bin).toBe("cmd");
    else expect(bin).toBe("xdg-open");
  });
});
