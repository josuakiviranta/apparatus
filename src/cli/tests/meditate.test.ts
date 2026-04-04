import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  pidPath,
  writePid,
  readPid,
  removePid,
  isPidAlive,
  ensureMeditationDirs,
  appendMeditateGitignore,
  buildMeditationArgs,
  writeMcpConfig,
  cleanupMcpConfig,
} from "../commands/meditate";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-meditate-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
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

  it("adds .mcp.ralph-*.json to .gitignore", () => {
    appendMeditateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(content).toContain(".mcp.ralph-*.json");
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

describe("writeMcpConfig", () => {
  it("writes a .mcp.ralph-<pid>.json file in the project folder", () => {
    const configPath = writeMcpConfig(tmpDir);
    expect(existsSync(configPath)).toBe(true);
    expect(configPath).toMatch(/\.mcp\.ralph-\d+\.json$/);
  });

  it("config JSON contains illumination mcpServer entry with correct projectRoot", () => {
    const configPath = writeMcpConfig(tmpDir);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.mcpServers.illumination).toBeDefined();
    const args: string[] = config.mcpServers.illumination.args;
    expect(args[1]).toBe(tmpDir);           // projectRoot is second arg
    expect(args[2]).toMatch(/meditations$/); // meditationsDir is third arg
  });
});

describe("cleanupMcpConfig", () => {
  it("removes the config file if it exists", () => {
    const configPath = writeMcpConfig(tmpDir);
    cleanupMcpConfig(configPath);
    expect(existsSync(configPath)).toBe(false);
  });

  it("does not throw if the file does not exist", () => {
    expect(() => cleanupMcpConfig(join(tmpDir, "nonexistent.json"))).not.toThrow();
  });
});

describe("buildMeditationArgs", () => {
  const absPath = "/fake/project";
  const prompt = "test prompt";
  const mcpConfigPath = "/fake/project/.mcp.ralph-12345.json";

  it("does not include native Read or Glob in allowedTools", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const allowed = args
      .map((a, i) => (args[i - 1] === "--allowedTools" ? a : null))
      .filter(Boolean);
    expect(allowed).not.toContain("Read");
    expect(allowed).not.toContain("Glob");
  });

  it("allows the three MCP read/glob/tree tools", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const allowed = args
      .map((a, i) => (args[i - 1] === "--allowedTools" ? a : null))
      .filter(Boolean);
    expect(allowed).toContain("mcp__illumination__read_file");
    expect(allowed).toContain("mcp__illumination__glob_files");
    expect(allowed).toContain("mcp__illumination__project_tree");
  });

  it("allows the MCP illumination tool", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const allowed = args
      .map((a, i) => (args[i - 1] === "--allowedTools" ? a : null))
      .filter(Boolean);
    expect(allowed).toContain("mcp__illumination__write_illumination");
  });

  it("does not allow Write tool", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const allowed = args
      .map((a, i) => (args[i - 1] === "--allowedTools" ? a : null))
      .filter(Boolean);
    expect(allowed.some((a) => a?.startsWith("Write"))).toBe(false);
  });

  it("does not disallow ToolSearch explicitly (not in allowedTools is sufficient)", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    expect(args).not.toContain("--disallowedTools");
  });

  it("passes --mcp-config with the config path", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const idx = args.indexOf("--mcp-config");
    expect(args[idx + 1]).toBe(mcpConfigPath);
  });

  it("sets permission-mode to dontAsk", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const modeIdx = args.indexOf("--permission-mode");
    expect(args[modeIdx + 1]).toBe("dontAsk");
  });

  it("sets --add-dir to absPath", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const dirIdx = args.indexOf("--add-dir");
    expect(args[dirIdx + 1]).toBe(absPath);
  });

  it("passes prompt text via -p flag", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toBe(prompt);
  });

  it("includes mcp__illumination__list_meta_meditations in allowedTools", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    expect(args).toContain("mcp__illumination__list_meta_meditations");
  });

  it("includes mcp__illumination__read_meta_meditation in allowedTools", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    expect(args).toContain("mcp__illumination__read_meta_meditation");
  });
});

