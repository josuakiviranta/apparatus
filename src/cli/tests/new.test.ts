import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../lib/output.js", () => ({
  header: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  error: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  spinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  stream: vi.fn(async () => {}),
}));

import * as pipelineMod from "../commands/pipeline.js";
import { scaffoldProject, newCommand } from "../commands/new";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-new-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("scaffoldProject", () => {
  it("creates empty scaffold files", () => {
    scaffoldProject(tmpDir, "my-project");
    for (const f of ["AGENTS.md", "IMPLEMENTATION_PLAN.md", "README.md"]) {
      expect(existsSync(join(tmpDir, f)), `${f} should exist`).toBe(true);
      expect(readFileSync(join(tmpDir, f), "utf8")).toBe("");
    }
  });

  it("creates .gitignore with correct entries", () => {
    scaffoldProject(tmpDir, "my-project");
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(content).toContain("IMPLEMENTATION_PLAN.md");
  });

  it("creates src/ directory (language-agnostic, no subdirs)", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "src"))).toBe(true);
    expect(existsSync(join(tmpDir, "src", "tests"))).toBe(false);
  });

  it("does not scaffold scenario-tests/ or scenario-runs/", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "scenario-tests"))).toBe(false);
    expect(existsSync(join(tmpDir, "scenario-runs"))).toBe(false);
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

  it("does not include scenario-runs/ in .gitignore", () => {
    scaffoldProject(tmpDir, "my-project");
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).not.toContain("scenario-runs/");
  });

  it("does not create src/tests/ subdirectories", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "src", "tests"))).toBe(false);
  });
});

describe("newCommand (shim)", () => {
  it("delegates to pipelineRunCommand with the bundled new template + project_name variable", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    const projectArg = join(tmpDir, `proj-${Math.random().toString(36).slice(2, 8)}`);
    await newCommand(projectArg);
    expect(calls).toHaveLength(1);
    expect(calls[0].dotFile.endsWith("new/pipeline.dot")).toBe(true);
    expect(calls[0].opts.project).toBe(projectArg);
    expect(calls[0].opts.variables.project_name).toBe(projectArg);
  });

  it("scaffolds project files before invoking the pipeline", async () => {
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async () => {});
    const projectArg = join(tmpDir, `proj-${Math.random().toString(36).slice(2, 8)}`);
    await newCommand(projectArg);
    expect(existsSync(join(projectArg, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(projectArg, "specs"))).toBe(true);
    expect(existsSync(join(projectArg, ".git"))).toBe(true);
  });
});
