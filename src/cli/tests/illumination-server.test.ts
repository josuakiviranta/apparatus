import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateFilename, writeIllumination } from "../mcp/illumination-server";

let tmpDir: string;

beforeEach(() => {
  tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-test-")));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("validateFilename", () => {
  it("accepts a valid kebab-slug filename", () => {
    expect(validateFilename("2026-04-04T1430-my-insight.md")).toBeNull();
  });

  it("accepts underscores", () => {
    expect(validateFilename("my_insight.md")).toBeNull();
  });

  it("rejects filename containing a slash", () => {
    expect(validateFilename("some/path.md")).not.toBeNull();
  });

  it("rejects filename containing ..", () => {
    expect(validateFilename("../escape.md")).not.toBeNull();
  });

  it("rejects filename containing a colon", () => {
    expect(validateFilename("2026-04-04T14:30-slug.md")).not.toBeNull();
  });

  it("rejects filename without .md extension", () => {
    expect(validateFilename("my-insight.txt")).not.toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateFilename("")).not.toBeNull();
  });
});

describe("writeIllumination", () => {
  it("writes content to meditations/illuminations/<filename>", () => {
    const result = writeIllumination(tmpDir, "2026-04-04T1430-test.md", "# Hello");
    const expected = join(tmpDir, "meditations", "illuminations", "2026-04-04T1430-test.md");
    expect(result).toBe(expected);
    expect(readFileSync(expected, "utf8")).toBe("# Hello");
  });

  it("overwrites an existing file without error", () => {
    writeIllumination(tmpDir, "test.md", "v1");
    const result = writeIllumination(tmpDir, "test.md", "v2");
    expect(readFileSync(result, "utf8")).toBe("v2");
  });

  it("creates meditations/illuminations/ directory if absent", () => {
    writeIllumination(tmpDir, "test.md", "content");
    expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
  });

  it("throws an error for an invalid filename", () => {
    expect(() => writeIllumination(tmpDir, "bad/name.md", "content")).toThrow();
  });
});
