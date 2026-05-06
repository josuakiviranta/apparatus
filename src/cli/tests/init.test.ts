// src/cli/tests/init.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "../commands/init.js";

function gitAvailable(): boolean {
  try { execSync("git --version", { stdio: "ignore" }); return true; }
  catch { return false; }
}

describe("apparat init", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "apparat-init-test-"));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("scaffolds the .apparat/ tree on a fresh directory", async () => {
    await initCommand(projectDir);

    expect(existsSync(join(projectDir, ".apparat"))).toBe(true);
    expect(existsSync(join(projectDir, ".apparat/pipelines"))).toBe(true);
    expect(existsSync(join(projectDir, ".apparat/meditations/illuminations"))).toBe(true);
    expect(existsSync(join(projectDir, ".apparat/meditations/stimuli"))).toBe(true);
    expect(existsSync(join(projectDir, ".apparat/sessions"))).toBe(true);
    expect(existsSync(join(projectDir, "docs/adr"))).toBe(true);
    expect(existsSync(join(projectDir, "VISION.md"))).toBe(true);
    expect(existsSync(join(projectDir, "CONTEXT.md"))).toBe(true);
  });

  it("scaffolds README.md at root if absent", async () => {
    await initCommand(projectDir);
    expect(existsSync(join(projectDir, "README.md"))).toBe(true);
  });

  it("does not overwrite an existing README.md", async () => {
    writeFileSync(join(projectDir, "README.md"), "existing content");
    await initCommand(projectDir);
    expect(readFileSync(join(projectDir, "README.md"), "utf8")).toBe("existing content");
  });

  it("does not overwrite an existing VISION.md", async () => {
    writeFileSync(join(projectDir, "VISION.md"), "my vision");
    await initCommand(projectDir);
    expect(readFileSync(join(projectDir, "VISION.md"), "utf8")).toBe("my vision");
  });

  it("appends .apparat/runs/ to .gitignore (creating the file if absent)", async () => {
    await initCommand(projectDir);
    const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".apparat/runs/");
  });

  it("does not duplicate the .apparat/runs/ line on second invocation", async () => {
    await initCommand(projectDir);
    await initCommand(projectDir);
    const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf8");
    const matches = gitignore.match(/^\.apparat\/runs\/$/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it("is idempotent — running twice yields the same tree", async () => {
    await initCommand(projectDir);
    const firstSnapshot = JSON.stringify({
      vision: readFileSync(join(projectDir, "VISION.md"), "utf8"),
      context: readFileSync(join(projectDir, "CONTEXT.md"), "utf8"),
    });
    await initCommand(projectDir);
    const secondSnapshot = JSON.stringify({
      vision: readFileSync(join(projectDir, "VISION.md"), "utf8"),
      context: readFileSync(join(projectDir, "CONTEXT.md"), "utf8"),
    });
    expect(secondSnapshot).toBe(firstSnapshot);
  });

  it("fills in missing subfolders on a partial existing .apparat/", async () => {
    mkdirSync(join(projectDir, ".apparat/pipelines"), { recursive: true });
    // .apparat/ exists with only pipelines/; meditations/, sessions/, docs/ are missing
    await initCommand(projectDir);
    expect(existsSync(join(projectDir, ".apparat/meditations/illuminations"))).toBe(true);
    expect(existsSync(join(projectDir, ".apparat/sessions"))).toBe(true);
    expect(existsSync(join(projectDir, "docs/adr"))).toBe(true);
  });

  it.skipIf(!gitAvailable())("runs git init if the directory is not a repo", async () => {
    await initCommand(projectDir);
    expect(existsSync(join(projectDir, ".git"))).toBe(true);
  });

  it("does not re-init an existing git repo", async () => {
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    writeFileSync(join(projectDir, ".git/sentinel"), "marker");
    await initCommand(projectDir);
    expect(readFileSync(join(projectDir, ".git/sentinel"), "utf8")).toBe("marker");
  });

  it("copies the apparatus SKILL.md shim to .claude/skills/apparatus/", async () => {
    await initCommand(projectDir);
    const skillPath = join(projectDir, ".claude/skills/apparatus/SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    const body = readFileSync(skillPath, "utf8");
    expect(body).toContain("name: apparatus");
    expect(body).toContain("apparat pipeline run");
  });

  it("does not overwrite a customised SKILL.md on re-init", async () => {
    const skillPath = join(projectDir, ".claude/skills/apparatus/SKILL.md");
    mkdirSync(join(projectDir, ".claude/skills/apparatus"), { recursive: true });
    writeFileSync(skillPath, "custom skill content");
    await initCommand(projectDir);
    expect(readFileSync(skillPath, "utf8")).toBe("custom skill content");
  });

  it("does not copy the pipelines.md live reference into the project", async () => {
    await initCommand(projectDir);
    const refPath = join(projectDir, ".claude/skills/apparatus/pipelines.md");
    expect(existsSync(refPath)).toBe(false);
  });
});
