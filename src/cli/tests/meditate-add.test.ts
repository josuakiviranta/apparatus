import { describe, it, expect, vi, afterEach } from "vitest";
import { buildMeditateAddKickoffArgs, meditateAddCommand } from "../commands/meditate-add";
import { join } from "path";
import { tmpdir } from "os";

describe("buildMeditateAddKickoffArgs", () => {
  it("includes -p with the prompt text", () => {
    const args = buildMeditateAddKickoffArgs("my prompt");
    const idx = args.indexOf("-p");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("my prompt");
  });

  it("includes --output-format stream-json", () => {
    const args = buildMeditateAddKickoffArgs("x");
    const idx = args.indexOf("--output-format");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --dangerously-skip-permissions", () => {
    const args = buildMeditateAddKickoffArgs("x");
    expect(args).toContain("--dangerously-skip-permissions");
  });
});

describe("meditateAddCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits with error if project folder does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await meditateAddCommand(join(tmpdir(), "ralph-nonexistent-" + Date.now()));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("project folder not found"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
