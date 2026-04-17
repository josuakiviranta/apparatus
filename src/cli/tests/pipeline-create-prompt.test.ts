import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { composeCreatePrompt } from "../lib/pipeline-create-prompt.js";

describe("composeCreatePrompt", () => {
  it("returns base prompt content", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "compose-"));
    const result = composeCreatePrompt(tmpDir);
    expect(result).toContain("Pipeline Workflow Author");
  });

  it("appends Available agents section when agents exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "compose-"));
    const agentsDir = join(tmpDir, ".ralph", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "reviewer.md"),
      `---\ndescription: Code review agent\n---\nYou review code.`,
    );
    const result = composeCreatePrompt(tmpDir);
    expect(result).toContain("Available agents");
    expect(result).toContain("reviewer");
  });

  it("does not throw when no user agents dir exists", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "compose-"));
    expect(() => composeCreatePrompt(tmpDir)).not.toThrow();
  });

  it("includes tool-node side effects guidance steering to script_file=", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "compose-"));
    const result = composeCreatePrompt(tmpDir);
    expect(result).toContain("Tool-node side effects");
    expect(result).toContain("script_file=");
    expect(result).toContain("Do **not** inline");
    expect(result).toContain("process.argv");
  });
});
