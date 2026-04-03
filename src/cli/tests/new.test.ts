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
  it("creates the top-level empty files", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");

    for (const f of ["AGENTS.md", "IMPLEMENTATION_PLAN.md", "PROMPT_build.md", "PROMPT_plan.md", "README.md"]) {
      expect(existsSync(join(target, f)), `${f} should exist`).toBe(true);
      expect(readFileSync(join(target, f), "utf8")).toBe("");
    }
  });

  it("creates .gitignore with correct entries", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");

    const content = readFileSync(join(target, ".gitignore"), "utf8");
    expect(content).toContain("PROMPT-*.md");
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
});

describe("buildKickoffPrompt", () => {
  it("substitutes {{PROJECT_NAME}} with the given name", () => {
    const template = 'Hello "{{PROJECT_NAME}}", welcome to {{PROJECT_NAME}}!';
    const result = buildKickoffPrompt(template, "my-app");
    expect(result).toBe('Hello "my-app", welcome to my-app!');
  });

  it("leaves the template unchanged if no placeholder present", () => {
    const template = "No placeholder here.";
    const result = buildKickoffPrompt(template, "my-app");
    expect(result).toBe("No placeholder here.");
  });
});
