import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
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
import {
  pidPath,
  writePid,
  readPid,
  removePid,
  isPidAlive,
  ensureMeditationDirs,
  appendMeditateGitignore,
  meditateCommand,
} from "../commands/meditate";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-meditate-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("ensureMeditationDirs", () => {
  it("creates meditations/illuminations/ nested structure", () => {
    ensureMeditationDirs(tmpDir);
    expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
  });

  it("is idempotent — does not throw if dirs already exist", () => {
    ensureMeditationDirs(tmpDir);
    expect(() => ensureMeditationDirs(tmpDir)).not.toThrow();
  });

  it("creates only the meditations/illuminations/ directory (no side folders)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ralph-meditate-dirs-"));
    try {
      ensureMeditationDirs(tmp);
      expect(existsSync(join(tmp, "meditations", "illuminations"))).toBe(true);
      expect(existsSync(join(tmp, "meditations", "archived-illuminations"))).toBe(false);
      expect(existsSync(join(tmp, "meditations", "implemented-illuminations"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("appendMeditateGitignore", () => {
  it("adds .meditate.json, .meditate.log, and .meditate.pid to .gitignore", () => {
    appendMeditateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(content).toContain(".meditate.json");
    expect(content).toContain(".meditate.log");
    expect(content).toContain(".meditate.pid");
  });

  it("creates .gitignore if it does not exist", () => {
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(false);
    appendMeditateGitignore(tmpDir);
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
  });

  it("does not duplicate entries if called twice", () => {
    appendMeditateGitignore(tmpDir);
    appendMeditateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    const count = (content.match(/\.meditate\.json/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("adds .mcp-*-*.json to .gitignore", () => {
    appendMeditateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(content).toContain(".mcp-*-*.json");
  });
});

describe("pidPath", () => {
  it("returns <folder>/.meditate.pid", () => {
    expect(pidPath("/some/project")).toBe("/some/project/.meditate.pid");
  });
});

describe("writePid / readPid / removePid", () => {
  it("writes and reads back the PID", () => {
    writePid(tmpDir, 12345);
    expect(readPid(tmpDir)).toBe(12345);
  });

  it("readPid returns null when file does not exist", () => {
    expect(readPid(tmpDir)).toBeNull();
  });

  it("removePid deletes the file", () => {
    writePid(tmpDir, 99);
    removePid(tmpDir);
    expect(readPid(tmpDir)).toBeNull();
  });

  it("removePid is a no-op if file does not exist", () => {
    expect(() => removePid(tmpDir)).not.toThrow();
  });
});

describe("isPidAlive", () => {
  it("returns true for the current process PID", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for a PID that is not running", () => {
    expect(isPidAlive(999999999)).toBe(false);
  });
});

describe("meditate template agent tool whitelist", () => {
  const templatePath = join(__dirname, "..", "pipelines", "meditate", "meditate.md");

  it("includes list_illuminations in the tools list", () => {
    const agentMd = readFileSync(templatePath, "utf-8");
    const toolsMatch = agentMd.match(/^tools:\n((?:\s+-\s+.+\n)+)/m);
    expect(toolsMatch).not.toBeNull();
    const tools = toolsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
    expect(tools).toContain("mcp__illumination__list_illuminations");
  });

  it("whitelists exactly the 7 reflective-only tools", () => {
    const agentMd = readFileSync(templatePath, "utf-8");
    const toolsMatch = agentMd.match(/^tools:\n((?:\s+-\s+.+\n)+)/m);
    expect(toolsMatch).not.toBeNull();
    const tools = toolsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
    expect(tools).toHaveLength(7);

    const expected = [
      "mcp__illumination__list_illuminations",
      "mcp__illumination__read_file",
      "mcp__illumination__glob_files",
      "mcp__illumination__project_tree",
      "mcp__illumination__write_illumination",
      "mcp__illumination__list_meta_meditations",
      "mcp__illumination__read_meta_meditation",
    ];
    for (const tool of expected) {
      expect(tools).toContain(tool);
    }
  });

  it("does not whitelist any lifecycle (state-mutating) tools", () => {
    const agentMd = readFileSync(templatePath, "utf-8");
    const toolsMatch = agentMd.match(/^tools:\n((?:\s+-\s+.+\n)+)/m);
    expect(toolsMatch).not.toBeNull();
    const tools = toolsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);

    const forbidden = [
      "mcp__illumination__mark_implemented",
      "mcp__illumination__mark_dispatched",
      "mcp__illumination__mark_archived",
      "mcp__illumination__list_plans",
      "mcp__illumination__mark_plan_implemented",
    ];
    for (const tool of forbidden) {
      expect(tools).not.toContain(tool);
    }
  });

  it("body does not reference any removed lifecycle tool name", () => {
    const agentMd = readFileSync(templatePath, "utf-8");
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length);

    const removedNames = [
      "mark_implemented",
      "mark_dispatched",
      "mark_archived",
      "list_plans",
      "mark_plan_implemented",
    ];
    for (const name of removedNames) {
      expect(body).not.toContain(name);
    }
  });
});

describe("meditateCommand (shim)", () => {
  it("delegates to pipelineRunCommand with the bundled meditate template + steer variable", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir, { variables: { steer: "focus on auth flow" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].dotFile.endsWith("meditate/pipeline.dot")).toBe(true);
    expect(calls[0].opts.project).toBe(tmpDir);
    expect(calls[0].opts.variables.steer).toBe("focus on auth flow");
  });

  it("passes empty steer string when --var steer=... is omitted", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables.steer).toBe("");
  });

  it("runs preflight: ensureMeditationDirs + appendMeditateGitignore before pipeline", async () => {
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async () => {});
    await meditateCommand(tmpDir);
    expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
  });

  it("removes PID file after pipeline completes", async () => {
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async () => {});
    await meditateCommand(tmpDir);
    expect(existsSync(pidPath(tmpDir))).toBe(false);
  });

  it("reads <project>/VISION.md and passes it as the vision variable", async () => {
    const visionContent = "# Project Vision\n\nNorth-star content for the meditate agent.";
    writeFileSync(join(tmpDir, "VISION.md"), visionContent);
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables.vision).toBe(visionContent);
  });

  it("passes empty vision string when VISION.md is absent", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables.vision).toBe("");
  });

  it("passes specs_dir default of docs/specs to pipeline runtime", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables.specs_dir).toBe("docs/specs");
  });
});

describe("meditate template agent prompt body — exploration scope", () => {
  it("exploration step weights $specs_dir and src/ folders", () => {
    const agentMd = readFileSync(
      join(__dirname, "..", "pipelines", "meditate", "meditate.md"),
      "utf-8",
    );
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length);

    expect(body).toMatch(/\$specs_dir/);
    expect(body).toContain("src/");
    expect(body.toLowerCase()).toContain("weighted focus");
  });
});

describe("meditate template agent prompt body — reflection brief", () => {
  it("reflection step asks for architect-mode lenses", () => {
    const agentMd = readFileSync(
      join(__dirname, "..", "pipelines", "meditate", "meditate.md"),
      "utf-8",
    );
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length).toLowerCase();

    expect(body).toContain("architect");
    expect(body).toMatch(/scalab/);
    expect(body).toMatch(/feature creep|bloat/);
    expect(body).toContain("abstraction");
  });
});
