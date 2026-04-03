import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapPrompts, BootstrapResult } from "../lib/prompts";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `ralph-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("bootstrapPrompts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns needsSetup=false when both prompts exist", async () => {
    writeFileSync(join(tmpDir, "PROMPT_plan.md"), "plan content");
    writeFileSync(join(tmpDir, "PROMPT_build.md"), "build content");

    const result = await bootstrapPrompts(tmpDir);

    expect(result.needsSetup).toBe(false);
    expect(result.injected).toEqual([]);
  });

  it("injects PROMPT_plan.md when missing", async () => {
    writeFileSync(join(tmpDir, "PROMPT_build.md"), "build content");

    const result = await bootstrapPrompts(tmpDir);

    expect(result.needsSetup).toBe(true);
    expect(result.injected).toContain("PROMPT_plan.md");
    expect(existsSync(join(tmpDir, "PROMPT_plan.md"))).toBe(true);
  });

  it("injects PROMPT_build.md when missing", async () => {
    writeFileSync(join(tmpDir, "PROMPT_plan.md"), "plan content");

    const result = await bootstrapPrompts(tmpDir);

    expect(result.needsSetup).toBe(true);
    expect(result.injected).toContain("PROMPT_build.md");
    expect(existsSync(join(tmpDir, "PROMPT_build.md"))).toBe(true);
  });

  it("injects both prompts when both are missing", async () => {
    const result = await bootstrapPrompts(tmpDir);

    expect(result.needsSetup).toBe(true);
    expect(result.injected).toContain("PROMPT_plan.md");
    expect(result.injected).toContain("PROMPT_build.md");
  });

  it("creates .gitignore and adds injected files", async () => {
    const result = await bootstrapPrompts(tmpDir);

    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("PROMPT_plan.md");
    expect(gitignore).toContain("PROMPT_build.md");
  });

  it("appends to existing .gitignore without duplicating", async () => {
    writeFileSync(join(tmpDir, ".gitignore"), "node_modules\n");

    const result = await bootstrapPrompts(tmpDir);

    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("node_modules");
    expect(gitignore).toContain("PROMPT_plan.md");
    // Run again - should not duplicate
    await bootstrapPrompts(tmpDir);
    const gitignore2 = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    const count = (gitignore2.match(/PROMPT_plan\.md/g) || []).length;
    expect(count).toBe(1);
  });

  it("errors if projectFolder does not exist", async () => {
    await expect(
      bootstrapPrompts("/nonexistent/path/that/does/not/exist")
    ).rejects.toThrow("does not exist");
  });
});
