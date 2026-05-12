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
import { pidPath } from "../lib/pipeline-bootstrap";
import { meditateCommand } from "../commands/meditate";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "apparat-meditate-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
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

  it("whitelists exactly the 8 reflective tools (7 read + mark_note_picked)", () => {
    const agentMd = readFileSync(templatePath, "utf-8");
    const toolsMatch = agentMd.match(/^tools:\n((?:\s+-\s+.+\n)+)/m);
    expect(toolsMatch).not.toBeNull();
    const tools = toolsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
    expect(tools).toHaveLength(8);

    const expected = [
      "mcp__illumination__list_illuminations",
      "mcp__illumination__read_file",
      "mcp__illumination__glob_files",
      "mcp__illumination__project_tree",
      "mcp__illumination__write_illumination",
      "mcp__illumination__list_stimuli",
      "mcp__illumination__read_stimulus",
      "mcp__illumination__mark_note_picked",
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
      "mcp__illumination__consume_plan",
    ];
    for (const tool of forbidden) {
      expect(tools).not.toContain(tool);
    }
  });

  it("mcp.args is exactly two entries: illumination server path + project root", () => {
    const agentMd = readFileSync(templatePath, "utf-8");
    const argsMatch = agentMd.match(/^\s+args:\n((?:\s+-\s+.+\n)+)/m);
    expect(argsMatch).not.toBeNull();
    const args = argsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+"?/, "").replace(/"?$/, "").trim())
      .filter(Boolean);
    expect(args).toEqual(["{{ILLUMINATION_SERVER_PATH}}", "{{PROJECT_ROOT}}"]);
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
      "consume_plan",
    ];
    for (const name of removedNames) {
      expect(body).not.toContain(name);
    }
  });

  it("body does not reference legacy meta-meditation tool names", () => {
    const agentMd = readFileSync(templatePath, "utf-8");
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length);

    expect(body).not.toContain("list_meta_meditations");
    expect(body).not.toContain("read_meta_meditation");
    expect(body).not.toContain("meta-meditation");
    expect(body).not.toContain("meta_meditation");
  });
});

describe("meditateCommand (shim)", () => {
  it("delegates to pipelineRunCommand with the bare meditate name + steer variable", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir, { variables: { steer: "focus on auth flow" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].dotFile).toBe("meditate");
    expect(calls[0].opts.project).toBe(tmpDir);
    expect(calls[0].opts.variables.steer).toBe("focus on auth flow");
  });

  it("prefers opts.steer over opts.variables.steer when both are passed", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir, {
      steer: "from-flag",
      variables: { steer: "from-var" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables.steer).toBe("from-flag");
  });

  it("uses opts.steer when opts.variables is absent", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir, { steer: "first-class only" });
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables.steer).toBe("first-class only");
  });

  it("hands the bare 'meditate' name through so the runtime resolver can pick a project-local override", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    // Bare name (not an absolute path) — proves the shim defers resolution to
    // pipelineRunCommand → resolvePipelineArg, which honors project overrides.
    expect(calls[0].dotFile).toBe("meditate");
    expect(calls[0].opts.project).toBe(tmpDir);
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
    expect(existsSync(join(tmpDir, ".apparat", "meditations", "illuminations"))).toBe(true);
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
  });

  it("removes PID file after pipeline completes", async () => {
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async () => {});
    await meditateCommand(tmpDir);
    expect(existsSync(pidPath(tmpDir))).toBe(false);
  });

  it("does NOT pass `vision` as a caller variable — the pipeline's read_vision tool node owns it", async () => {
    const visionContent = "# Project Vision\n\nNorth-star content for the meditate agent.";
    writeFileSync(join(tmpDir, "VISION.md"), visionContent);
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables).not.toHaveProperty("vision");
  });

  it("passes only `steer` (the single declared caller input) when --var is empty", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].opts.variables)).toEqual(["steer"]);
    expect(calls[0].opts.variables.steer).toBe("");
  });

  it("does NOT pass specs_dir to pipeline runtime", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables).not.toHaveProperty("specs_dir");
  });
});

describe("meditate template agent prompt body — exploration scope", () => {
  it("exploration step uses discover-then-read orientation, not $specs_dir", () => {
    const agentMd = readFileSync(
      join(__dirname, "..", "pipelines", "meditate", "meditate.md"),
      "utf-8",
    );
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length);

    expect(body).not.toMatch(/\$specs_dir/);
    expect(body).not.toMatch(/specs_dir/);
    expect(body).toContain("CONTEXT.md");
    expect(body).toContain("docs/adr");
    expect(body).toMatch(/src\/.*lib\/.*app\/.*pkg\/.*cmd\/.*internal\//s);
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
