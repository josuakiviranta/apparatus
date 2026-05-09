import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readProjects, recordProject, projectsFilePath } from "../lib/projects-registry.js";

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "apparat-registry-"));
  process.env.HOME = testHome;
  mkdirSync(join(testHome, ".apparat"), { recursive: true });
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  delete process.env.HOME;
});

describe("readProjects", () => {
  it("returns [] when projects.json does not exist", () => {
    expect(readProjects()).toEqual([]);
  });

  it("returns [] on malformed JSON without throwing", () => {
    writeFileSync(projectsFilePath(), "{not valid json");
    expect(readProjects()).toEqual([]);
  });

  it("returns parsed entries on valid JSON", () => {
    const entries = [{ path: "/work/a", lastSeen: 100 }];
    writeFileSync(projectsFilePath(), JSON.stringify(entries));
    expect(readProjects()).toEqual(entries);
  });
});

describe("recordProject", () => {
  it("creates the file with one entry on first call", () => {
    recordProject("/work/app");
    const entries = readProjects();
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("/work/app");
    expect(typeof entries[0].lastSeen).toBe("number");
  });

  it("is idempotent: second call updates lastSeen, no duplicate", () => {
    recordProject("/work/app");
    const first = readProjects()[0].lastSeen;
    // Simulate elapsed time
    const later = first + 1000;
    const origNow = Date.now;
    Date.now = () => later;
    try {
      recordProject("/work/app");
    } finally {
      Date.now = origNow;
    }
    const entries = readProjects();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastSeen).toBe(later);
  });

  it("appends distinct paths", () => {
    recordProject("/work/a");
    recordProject("/work/b");
    const paths = readProjects().map((e) => e.path).sort();
    expect(paths).toEqual(["/work/a", "/work/b"]);
  });

  it("does not throw when home directory is unwritable", function () {
    // Skip on root: chmod 500 doesn't restrict root, so the test is moot.
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return; // skip on root (CI may run as root)
    }
    chmodSync(testHome, 0o500);
    try {
      // Must not throw.
      expect(() => recordProject("/work/c")).not.toThrow();
    } finally {
      chmodSync(testHome, 0o700);
    }
  });
});
