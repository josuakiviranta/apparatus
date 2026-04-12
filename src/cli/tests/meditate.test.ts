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

// Capture RunOptions passed to agent.run()
let lastRunOptions: import("../lib/agent.js").RunOptions | undefined;
const mockAgentRun = vi.fn(async (opts: import("../lib/agent.js").RunOptions) => {
  lastRunOptions = opts;
  return { exitCode: 0, sessionId: null, stdout: null };
});

vi.mock("../lib/agent.js", () => ({
  Agent: vi.fn().mockImplementation(() => ({
    run: mockAgentRun,
    kill: vi.fn(),
  })),
  validateAgentConfig: vi.fn((c) => c),
}));

vi.mock("../lib/agent-registry.js", () => ({
  resolveAgent: vi.fn(() => ({
    name: "meditate",
    description: "test",
    model: "opus",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "system prompt",
  })),
}));

vi.mock("../lib/assets.js", () => ({
  getIlluminationServerPath: vi.fn(() => "/fake/server.js"),
  getMetaMeditationsDir: vi.fn(() => "/fake/meditations"),
}));

import {
  pidPath,
  writePid,
  readPid,
  removePid,
  isPidAlive,
  ensureMeditationDirs,
  appendMeditateGitignore,
  runMeditationSession,
  meditateCommand,
  meditateKillCommand,
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

describe("meditate agent tool whitelist", () => {
  it("includes list_illuminations in the tools list", () => {
    const agentMd = readFileSync(
      join(__dirname, "..", "agents", "meditate.md"),
      "utf-8",
    );
    const toolsMatch = agentMd.match(/^tools:\n((?:\s+-\s+.+\n)+)/m);
    expect(toolsMatch).not.toBeNull();
    const tools = toolsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
    expect(tools).toContain("mcp__illumination__list_illuminations");
  });

  it("whitelists all 8 illumination server tools", () => {
    const agentMd = readFileSync(
      join(__dirname, "..", "agents", "meditate.md"),
      "utf-8",
    );
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
      "mcp__illumination__mark_implemented",
      "mcp__illumination__list_meta_meditations",
      "mcp__illumination__read_meta_meditation",
    ];
    for (const tool of expected) {
      expect(tools).toContain(tool);
    }
  });
});

describe("runMeditationSession steer", () => {
  beforeEach(() => {
    lastRunOptions = undefined;
    mockAgentRun.mockClear();
  });

  it("passes message to agent.run() when steer is provided", async () => {
    await runMeditationSession(tmpDir, "focus on auth");
    expect(lastRunOptions?.message).toBe("focus on auth");
  });

  it("does not set message when steer is omitted", async () => {
    await runMeditationSession(tmpDir);
    expect(lastRunOptions?.message).toBeUndefined();
  });
});

describe("meditateCommand --steer passthrough", () => {
  beforeEach(() => {
    lastRunOptions = undefined;
    mockAgentRun.mockClear();
  });

  it("passes steer to runMeditationSession when provided", async () => {
    await meditateCommand(tmpDir, { steer: "focus on auth" });
    expect(lastRunOptions?.message).toBe("focus on auth");
  });

  it("does not set message when steer is omitted", async () => {
    await meditateCommand(tmpDir);
    expect(lastRunOptions?.message).toBeUndefined();
  });
});

