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
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");

    for (const f of ["AGENTS.md", "IMPLEMENTATION_PLAN.md", "README.md"]) {
      expect(existsSync(join(target, f)), `${f} should exist`).toBe(true);
      expect(readFileSync(join(target, f), "utf8")).toBe("");
    }
  });

  it("creates PROMPT files with bundled default content", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");

    for (const f of ["PROMPT_plan.md", "PROMPT_build.md"]) {
      expect(existsSync(join(target, f)), `${f} should exist`).toBe(true);
      expect(readFileSync(join(target, f), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("creates .gitignore with correct entries", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");

    const content = readFileSync(join(target, ".gitignore"), "utf8");
    expect(content).toContain("PROMPT_plan.md");
    expect(content).toContain("PROMPT_build.md");
    expect(content).toContain("IMPLEMENTATION_PLAN.md");
  });

  it("creates specs/ directory", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");
    expect(existsSync(join(target, "specs"))).toBe(true);
  });

  it("creates src/tests subdirectories", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");

    for (const sub of ["integration", "unit", "scenarios"]) {
      expect(existsSync(join(target, "src", "tests", sub)), `src/tests/${sub} should exist`).toBe(true);
    }
  });

  it("creates meditations/illuminations/ directory", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");
    expect(existsSync(join(target, "meditations", "illuminations"))).toBe(true);
  });

  it("adds meditate entries to .gitignore", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");
    const content = readFileSync(join(target, ".gitignore"), "utf8");
    expect(content).toContain("meditations/illuminations/");
    expect(content).toContain(".meditate.json");
    expect(content).toContain(".meditate.log");
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
