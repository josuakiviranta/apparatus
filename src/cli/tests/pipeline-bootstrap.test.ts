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
} from "../lib/pipeline-bootstrap";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "apparat-pipeline-bootstrap-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensureMeditationDirs", () => {
  it("creates .apparat/meditations/illuminations/ nested structure", () => {
    ensureMeditationDirs(tmpDir);
    expect(existsSync(join(tmpDir, ".apparat", "meditations", "illuminations"))).toBe(true);
  });

  it("is idempotent — does not throw if dirs already exist", () => {
    ensureMeditationDirs(tmpDir);
    expect(() => ensureMeditationDirs(tmpDir)).not.toThrow();
  });

  it("creates only the meditations/illuminations/ directory (no side folders)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-pipeline-bootstrap-dirs-"));
    try {
      ensureMeditationDirs(tmp);
      expect(existsSync(join(tmp, ".apparat", "meditations", "illuminations"))).toBe(true);
      expect(existsSync(join(tmp, ".apparat", "meditations", "archived-illuminations"))).toBe(false);
      expect(existsSync(join(tmp, ".apparat", "meditations", "implemented-illuminations"))).toBe(false);
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
