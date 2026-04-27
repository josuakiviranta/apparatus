import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scaffoldProject, buildKickoffPrompt } from "../commands/new";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-new-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("scaffoldProject", () => {
  it("creates empty scaffold files", () => {
    scaffoldProject(tmpDir, "my-project");
    for (const f of ["AGENTS.md", "IMPLEMENTATION_PLAN.md", "README.md"]) {
      expect(existsSync(join(tmpDir, f)), `${f} should exist`).toBe(true);
      expect(readFileSync(join(tmpDir, f), "utf8")).toBe("");
    }
  });

  it("creates PROMPT files with bundled default content", () => {
    scaffoldProject(tmpDir, "my-project");
    for (const f of ["PROMPT_plan.md", "PROMPT_build.md"]) {
      expect(existsSync(join(tmpDir, f)), `${f} should exist`).toBe(true);
      expect(readFileSync(join(tmpDir, f), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("creates .gitignore with correct entries", () => {
    scaffoldProject(tmpDir, "my-project");
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(content).toContain("PROMPT_plan.md");
    expect(content).toContain("PROMPT_build.md");
    expect(content).toContain("IMPLEMENTATION_PLAN.md");
  });

  it("creates src/ directory (language-agnostic, no subdirs)", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "src"))).toBe(true);
    // No TS-specific subdirs
    expect(existsSync(join(tmpDir, "src", "tests"))).toBe(false);
  });

  it("creates scenario-tests/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "scenario-tests"))).toBe(true);
  });

  it("creates scenario-runs/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "scenario-runs"))).toBe(true);
  });

  it("creates specs/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "specs"))).toBe(true);
  });

  it("does not include meditations/illuminations/ in .gitignore", () => {
    scaffoldProject(tmpDir, "my-project");
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).not.toContain("meditations/illuminations/");
  });

  it("scaffolds the three illumination subdirs", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
    expect(existsSync(join(tmpDir, "meditations", "archived-illuminations"))).toBe(true);
    expect(existsSync(join(tmpDir, "meditations", "implemented-illuminations"))).toBe(true);
  });

  it("adds scenario-runs/ to .gitignore", () => {
    scaffoldProject(tmpDir, "my-project");
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("scenario-runs/");
  });

  it("does not create src/tests/ subdirectories", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "src", "tests"))).toBe(false);
  });
});

const BRAINSTORM_TRIGGER = `Study specs/*.md and src/* in parallel using subagents to understand the project. Then invoke the Skill tool with skill name "superpowers:brainstorming".`;

describe("buildKickoffPrompt", () => {
  it("substitutes {{PROJECT_NAME}} with the given name", () => {
    const template = 'Hello "{{PROJECT_NAME}}", welcome to {{PROJECT_NAME}}!';
    const result = buildKickoffPrompt(template, "my-app");
    expect(result).toBe(`Hello "my-app", welcome to my-app!\n\n${BRAINSTORM_TRIGGER}`);
  });

  it("appends brainstorm trigger even with no placeholder", () => {
    const template = "No placeholder here.";
    const result = buildKickoffPrompt(template, "my-app");
    expect(result).toBe(`No placeholder here.\n\n${BRAINSTORM_TRIGGER}`);
  });

  it("ends with the brainstorm trigger", () => {
    const result = buildKickoffPrompt("Some kickoff content.", "my-app");
    expect(result).toContain('invoke the Skill tool with skill name "superpowers:brainstorming"');
  });
});
