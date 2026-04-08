import { describe, it, expect, vi, afterEach } from "vitest";
import { buildMeditateCreateKickoffArgs, meditateCreateCommand } from "../commands/meditate-create";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../lib/output.js", () => ({
  error: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
}));

import * as output from "../lib/output.js";

describe("buildMeditateCreateKickoffArgs", () => {
  it("includes -p with the prompt text", () => {
    const args = buildMeditateCreateKickoffArgs("my prompt");
    const idx = args.indexOf("-p");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("my prompt");
  });

  it("includes --output-format stream-json", () => {
    const args = buildMeditateCreateKickoffArgs("x");
    const idx = args.indexOf("--output-format");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --dangerously-skip-permissions", () => {
    const args = buildMeditateCreateKickoffArgs("x");
    expect(args).toContain("--dangerously-skip-permissions");
  });
});

describe("meditateCreateCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits with error if project folder does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await meditateCreateCommand(join(tmpdir(), "ralph-nonexistent-" + Date.now()));
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("project folder not found"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
