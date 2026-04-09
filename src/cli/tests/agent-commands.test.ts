import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("agent commands", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralph-agent-cmd-"));
    writeFileSync(
      join(tempDir, "reviewer.md"),
      `---\nname: reviewer\ndescription: Reviews code\nmodel: sonnet\npermissionMode: dontAsk\ntools:\n  - read_file\n---\n\nYou are a reviewer.`,
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("agentListAction returns agent info array", async () => {
    const { agentListAction } = await import("../commands/agent.js");
    const result = await agentListAction({ userDir: tempDir, bundledDir: tempDir });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "reviewer" }),
      ]),
    );
  });

  it("agentShowAction returns full config", async () => {
    const { agentShowAction } = await import("../commands/agent.js");
    const config = await agentShowAction("reviewer", {
      userDir: tempDir,
      bundledDir: tempDir,
    });
    expect(config.name).toBe("reviewer");
    expect(config.model).toBe("sonnet");
    expect(config.tools).toContain("read_file");
    expect(config.prompt.trim()).toBe("You are a reviewer.");
  });

  it("agentShowAction throws for unknown agent", async () => {
    const { agentShowAction } = await import("../commands/agent.js");
    await expect(
      agentShowAction("nonexistent", {
        userDir: tempDir,
        bundledDir: tempDir,
      }),
    ).rejects.toThrow('Unknown agent: "nonexistent"');
  });
});
