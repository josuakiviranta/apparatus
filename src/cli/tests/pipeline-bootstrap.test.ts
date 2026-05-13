import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
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
  assertApparatShape,
  ApparatShapeError,
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

describe("assertApparatShape", () => {
  it("passes when .apparat/ exists at the path", () => {
    mkdirSync(join(tmpDir, ".apparat"), { recursive: true });
    expect(() => assertApparatShape(tmpDir)).not.toThrow();
  });

  it("passes when VISION.md exists", () => {
    writeFileSync(join(tmpDir, "VISION.md"), "# Vision\n");
    expect(() => assertApparatShape(tmpDir)).not.toThrow();
  });

  it("passes when CONTEXT.md exists", () => {
    writeFileSync(join(tmpDir, "CONTEXT.md"), "# Domain Language\n");
    expect(() => assertApparatShape(tmpDir)).not.toThrow();
  });

  it("passes when .git/ exists", () => {
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    expect(() => assertApparatShape(tmpDir)).not.toThrow();
  });

  it("throws ApparatShapeError when path basename is '.apparat'", () => {
    const inner = join(tmpDir, ".apparat");
    mkdirSync(inner, { recursive: true });
    // Even though the inner folder exists, the basename rule must hard-refuse.
    let caught: unknown;
    try { assertApparatShape(inner); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApparatShapeError);
    expect((caught as Error).message).toMatch(/apparat-internal folder/i);
    expect((caught as Error).message).toContain(tmpDir);
  });

  it("throws ApparatShapeError when no shape signal is present", () => {
    let caught: unknown;
    try { assertApparatShape(tmpDir); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApparatShapeError);
    expect((caught as Error).message).toMatch(/does not look like an apparat-shaped project/i);
    expect((caught as Error).message).toMatch(/VISION\.md/);
    expect((caught as Error).message).toMatch(/CONTEXT\.md/);
    expect((caught as Error).message).toMatch(/\.apparat/);
    expect((caught as Error).message).toMatch(/\.git/);
  });
});
