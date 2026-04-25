import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { mockExecSync } = vi.hoisted(() => {
  const mockExecSync = vi.fn();
  return { mockExecSync };
});
vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

import { validateFilename, writeIllumination, assertWithinRoot, readFile, validateGlobPattern, globFiles, projectTree, listMetaMeditations, readMetaMeditation, listIlluminations, markImplemented, markDispatched, markArchived, listPlans, markPlanImplemented } from "../mcp/illumination-server";

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
    const result = writeIllumination(tmpDir, "2026-04-04T1430-test.md", "A test insight", "# Hello");
    const expected = join(tmpDir, "meditations", "illuminations", "2026-04-04T1430-test.md");
    expect(result).toBe(expected);
    expect(readFileSync(expected, "utf8")).toContain("# Hello");
  });

  it("overwrites an existing file without error", () => {
    writeIllumination(tmpDir, "test.md", "First version", "v1");
    const result = writeIllumination(tmpDir, "test.md", "Second version", "v2");
    expect(readFileSync(result, "utf8")).toContain("v2");
  });

  it("creates meditations/illuminations/ directory if absent", () => {
    writeIllumination(tmpDir, "test.md", "Some description", "content");
    expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
  });

  it("throws an error for an invalid filename", () => {
    expect(() => writeIllumination(tmpDir, "bad/name.md", "A description", "content")).toThrow();
  });

  it("prepends YAML frontmatter with date, status, and description", () => {
    writeIllumination(tmpDir, "test.md", "My core insight", "# Body");
    const written = readFileSync(join(tmpDir, "meditations", "illuminations", "test.md"), "utf8");
    const today = new Date().toISOString().slice(0, 10);
    expect(written).toMatch(new RegExp(`^---\\ndate: ${today}\\nstatus: open\\ndescription: My core insight\\n---\\n`));
  });

  it("includes status: open in frontmatter", () => {
    writeIllumination(tmpDir, "T1200-status-test.md", "Status test", "Body");
    const content = readFileSync(
      join(tmpDir, "meditations", "illuminations", "T1200-status-test.md"),
      "utf-8"
    );
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/status: open/);
  });

  it("places the content body after the frontmatter separator", () => {
    writeIllumination(tmpDir, "test.md", "Insight here", "# Body\nParagraph");
    const written = readFileSync(join(tmpDir, "meditations", "illuminations", "test.md"), "utf8");
    const parts = written.split("---\n");
    // parts[0] is empty (before first ---), parts[1] is frontmatter fields, rest is body
    const body = parts.slice(2).join("---\n");
    expect(body).toBe("\n# Body\nParagraph");
  });

  it("throws when description is empty", () => {
    expect(() => writeIllumination(tmpDir, "test.md", "", "content")).toThrow("description is required");
    expect(() => writeIllumination(tmpDir, "test.md", "   ", "content")).toThrow("description is required");
  });
});

describe("writeIllumination auto-commit", () => {
  beforeEach(() => {
    mockExecSync.mockClear();
  });

  it("calls git add then git commit after writing the file", () => {
    const filePath = writeIllumination(tmpDir, "2026-04-12T1000-auto-commit.md", "Test auto-commit", "# Body");
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    const addCall = mockExecSync.mock.calls[0][0] as string;
    const commitCall = mockExecSync.mock.calls[1][0] as string;
    expect(addCall).toContain("git -C");
    expect(addCall).toContain(tmpDir);
    expect(addCall).toContain("add");
    expect(addCall).toContain(filePath);
    expect(commitCall).toContain("git -C");
    expect(commitCall).toContain(tmpDir);
    expect(commitCall).toContain("commit");
    expect(commitCall).toContain("meditate: add illumination 2026-04-12T1000-auto-commit.md");
  });

  it("returns success even when git commands fail (fail-open)", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    const filePath = writeIllumination(tmpDir, "2026-04-12T1100-fail-open.md", "Fail open test", "# Body");
    expect(existsSync(filePath)).toBe(true);
  });

  it("handles 'nothing to commit' gracefully on re-write", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("commit")) throw new Error("nothing to commit");
      return undefined;
    });
    const filePath = writeIllumination(tmpDir, "2026-04-12T1200-rewrite.md", "Rewrite test", "# Body");
    expect(filePath).toContain("2026-04-12T1200-rewrite.md");
  });
});

describe("assertWithinRoot", () => {
  it("does not throw for a path directly inside root", () => {
    expect(() => assertWithinRoot("/proj/src/foo.ts", "/proj")).not.toThrow();
  });

  it("does not throw for root itself", () => {
    expect(() => assertWithinRoot("/proj", "/proj")).not.toThrow();
  });

  it("throws for a path with ../ traversal", () => {
    expect(() => assertWithinRoot("/proj/../etc/passwd", "/proj")).toThrow("outside the project folder");
  });

  it("throws for a completely different path", () => {
    expect(() => assertWithinRoot("/etc/passwd", "/proj")).toThrow("outside the project folder");
  });

  it("throws for a path that is a prefix match but not a child", () => {
    expect(() => assertWithinRoot("/proj2/file.ts", "/proj")).toThrow("outside the project folder");
  });
});

describe("readFile", () => {
  it("reads a file by relative path", () => {
    writeFileSync(join(tmpDir, "hello.txt"), "hello world");
    expect(readFile(tmpDir, "hello.txt")).toBe("hello world");
  });

  it("reads a file by absolute path within root", () => {
    writeFileSync(join(tmpDir, "abs.txt"), "absolute");
    expect(readFile(tmpDir, join(tmpDir, "abs.txt"))).toBe("absolute");
  });

  it("reads a file in a subdirectory", () => {
    mkdirSync(join(tmpDir, "sub"));
    writeFileSync(join(tmpDir, "sub", "deep.txt"), "deep");
    expect(readFile(tmpDir, "sub/deep.txt")).toBe("deep");
  });

  it("throws for a path with ../ traversal", () => {
    expect(() => readFile(tmpDir, "../outside.txt")).toThrow("outside the project folder");
  });

  it("throws for an absolute path outside root", () => {
    expect(() => readFile(tmpDir, "/etc/passwd")).toThrow("outside the project folder");
  });

  it("throws for a file that does not exist", () => {
    expect(() => readFile(tmpDir, "nonexistent.txt")).toThrow();
  });
});

describe("validateGlobPattern", () => {
  it("accepts a relative pattern", () => {
    expect(validateGlobPattern("src/**/*.ts")).toBeNull();
  });

  it("accepts a simple filename pattern", () => {
    expect(validateGlobPattern("*.md")).toBeNull();
  });

  it("rejects a pattern starting with /", () => {
    expect(validateGlobPattern("/etc/**")).not.toBeNull();
  });

  it("rejects a pattern containing ..", () => {
    expect(validateGlobPattern("../outside/**")).not.toBeNull();
  });

  it("rejects a pattern with .. in the middle", () => {
    expect(validateGlobPattern("src/../../etc")).not.toBeNull();
  });
});

describe("globFiles", () => {
  it("returns newline-separated relative paths for matching files", async () => {
    writeFileSync(join(tmpDir, "foo.ts"), "");
    writeFileSync(join(tmpDir, "bar.ts"), "");
    const result = await globFiles(tmpDir, "*.ts");
    const paths = result.split("\n");
    expect(paths).toContain("foo.ts");
    expect(paths).toContain("bar.ts");
  });

  it("matches files in subdirectories", async () => {
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "index.ts"), "");
    const result = await globFiles(tmpDir, "src/*.ts");
    expect(result.split("\n")).toContain("src/index.ts");
  });

  it("returns no-match message when nothing matches", async () => {
    const result = await globFiles(tmpDir, "*.nonexistent");
    expect(result).toBe("No files matched pattern: *.nonexistent");
  });

  it("throws for a pattern starting with /", async () => {
    await expect(globFiles(tmpDir, "/etc/**")).rejects.toThrow();
  });

  it("throws for a pattern containing ..", async () => {
    await expect(globFiles(tmpDir, "../outside/**")).rejects.toThrow();
  });
});

describe("projectTree", () => {
  it("returns a tree of files and folders relative to root", () => {
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "index.ts"), "");
    writeFileSync(join(tmpDir, "README.md"), "");
    const result = projectTree(tmpDir);
    expect(result).toContain("src/");
    expect(result).toContain("README.md");
  });

  it("nests files under their directory with 2-space indent", () => {
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "index.ts"), "");
    const result = projectTree(tmpDir);
    expect(result).toContain("  index.ts");
  });

  it("skips node_modules", () => {
    mkdirSync(join(tmpDir, "node_modules"));
    writeFileSync(join(tmpDir, "node_modules", "pkg.js"), "");
    const result = projectTree(tmpDir);
    expect(result).not.toContain("node_modules");
  });

  it("skips .git", () => {
    mkdirSync(join(tmpDir, ".git"));
    writeFileSync(join(tmpDir, ".git", "config"), "");
    const result = projectTree(tmpDir);
    expect(result).not.toContain(".git");
  });

  it("skips dist, build, coverage via SKIP_DIRS", () => {
    for (const name of ["dist", "build", "coverage"]) {
      mkdirSync(join(tmpDir, name));
      writeFileSync(join(tmpDir, name, "file.js"), "");
    }
    writeFileSync(join(tmpDir, "index.ts"), "");
    const result = projectTree(tmpDir);
    expect(result).not.toContain("dist");
    expect(result).not.toContain("build");
    expect(result).not.toContain("coverage");
    expect(result).toContain("index.ts");
  });

  it("returns Directory is empty for an empty folder", () => {
    mkdirSync(join(tmpDir, "empty"));
    expect(projectTree(tmpDir, "empty")).toBe("Directory is empty");
  });

  it("roots the tree at the subdirectory when subPath given", () => {
    mkdirSync(join(tmpDir, "sub"));
    writeFileSync(join(tmpDir, "sub", "file.ts"), "");
    writeFileSync(join(tmpDir, "root.ts"), "");
    const result = projectTree(tmpDir, "sub");
    expect(result).toContain("file.ts");
    expect(result).not.toContain("root.ts");
    expect(result).not.toContain("sub/");
  });

  it("throws for a subPath outside project root", () => {
    expect(() => projectTree(tmpDir, "../outside")).toThrow("outside the project folder");
  });

  it("skips node-compile-cache", () => {
    mkdirSync(join(tmpDir, "node-compile-cache"));
    writeFileSync(join(tmpDir, "node-compile-cache", "abc123.bin"), "");
    writeFileSync(join(tmpDir, "index.ts"), "");
    const result = projectTree(tmpDir);
    expect(result).not.toContain("node-compile-cache");
    expect(result).toContain("index.ts");
  });

  it("excludes directories listed in .gitignore", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "vendor/\n");
    mkdirSync(join(tmpDir, "vendor"));
    writeFileSync(join(tmpDir, "vendor", "dep.js"), "");
    writeFileSync(join(tmpDir, "index.ts"), "");
    const result = projectTree(tmpDir);
    expect(result).not.toContain("vendor");
    expect(result).toContain("index.ts");
  });

  it("falls back gracefully when no .gitignore exists", () => {
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "index.ts"), "");
    // No .gitignore present
    const result = projectTree(tmpDir);
    expect(result).toContain("src/");
    expect(result).toContain("index.ts");
  });

  it("excludes gitignored subdirectory when walking from a subPath", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "generated/\n");
    mkdirSync(join(tmpDir, "src"));
    mkdirSync(join(tmpDir, "src", "generated"));
    writeFileSync(join(tmpDir, "src", "main.ts"), "");
    writeFileSync(join(tmpDir, "src", "generated", "types.ts"), "");
    const result = projectTree(tmpDir, "src");
    expect(result).toContain("main.ts");
    expect(result).not.toContain("generated");
  });
});

describe("listMetaMeditations", () => {
  it("returns newline-separated sorted filenames when dir has .md files", () => {
    writeFileSync(join(tmpDir, "b-lens.md"), "content b");
    writeFileSync(join(tmpDir, "a-lens.md"), "content a");
    const result = listMetaMeditations(tmpDir);
    expect(result).toBe("a-lens.md\nb-lens.md");
  });

  it("only lists .md files, ignoring other file types", () => {
    writeFileSync(join(tmpDir, "a-lens.md"), "");
    writeFileSync(join(tmpDir, "config.json"), "");
    const result = listMetaMeditations(tmpDir);
    expect(result).toContain("a-lens.md");
    expect(result).not.toContain("config.json");
  });

  it("returns explanatory message with instructions when dir is empty", () => {
    const result = listMetaMeditations(tmpDir);
    expect(result).toContain("No meta-meditations found");
    expect(result).toContain("meditations/");
  });

  it("returns explanatory message with instructions when dir does not exist", () => {
    const result = listMetaMeditations(join(tmpDir, "nonexistent"));
    expect(result).toContain("No meta-meditations found");
    expect(result).toContain("meditations/");
  });
});

describe("readMetaMeditation", () => {
  it("returns file content for a valid existing filename", () => {
    writeFileSync(join(tmpDir, "my-lens.md"), "# My Lens\ncontent here");
    expect(readMetaMeditation(tmpDir, "my-lens.md")).toBe("# My Lens\ncontent here");
  });

  it("returns error for path traversal attempt (../secrets.md)", () => {
    const result = readMetaMeditation(tmpDir, "../secrets.md");
    expect(result).toMatch(/^Error:/);
  });

  it("returns error for filename without .md extension", () => {
    const result = readMetaMeditation(tmpDir, "lens.txt");
    expect(result).toMatch(/^Error:/);
  });

  it("returns error when file does not exist", () => {
    const result = readMetaMeditation(tmpDir, "nonexistent.md");
    expect(result).toMatch(/^Error:/);
    expect(result).toContain("nonexistent.md");
  });
});

describe("listIlluminations", () => {
  it("returns no-illuminations message when directory is missing", () => {
    const result = listIlluminations(tmpDir);
    expect(result).toBe("No illuminations found.");
  });

  it("returns no-illuminations message when directory is empty", () => {
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
    const result = listIlluminations(tmpDir);
    expect(result).toBe("No illuminations found.");
  });

  it("returns filename and description for a file with frontmatter", () => {
    const dir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-04-08T0900-my-insight.md"), "---\ndate: 2026-04-08\ndescription: Something important.\n---\n\n# My Insight\n\nBody.");
    const result = listIlluminations(tmpDir);
    expect(result).toBe("2026-04-08T0900-my-insight.md — Something important.");
  });

  it("shows (no description) for a file without frontmatter", () => {
    const dir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "old-insight.md"), "# Old Insight\n\nNo frontmatter here.");
    const result = listIlluminations(tmpDir);
    expect(result).toBe("old-insight.md — (no description)");
  });

  it("shows (no description) for a file with frontmatter missing description field", () => {
    const dir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "partial.md"), "---\ndate: 2026-04-08\n---\n\n# Partial");
    const result = listIlluminations(tmpDir);
    expect(result).toBe("partial.md — (no description)");
  });

  it("lists multiple files sorted by filename", () => {
    const dir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-04-08T1100-second.md"), "---\ndate: 2026-04-08\ndescription: Second insight.\n---\n\n# Second");
    writeFileSync(join(dir, "2026-04-08T0900-first.md"), "---\ndate: 2026-04-08\ndescription: First insight.\n---\n\n# First");
    const result = listIlluminations(tmpDir);
    expect(result).toBe(
      "2026-04-08T0900-first.md — First insight.\n2026-04-08T1100-second.md — Second insight."
    );
  });

  it("filters by status when status parameter provided", () => {
    const illumDir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(illumDir, { recursive: true });
    writeFileSync(
      join(illumDir, "T1000-open.md"),
      "---\ndate: 2026-04-12\nstatus: open\ndescription: Open one\n---\n\nBody"
    );
    writeFileSync(
      join(illumDir, "T1100-dispatched.md"),
      "---\ndate: 2026-04-12\nstatus: dispatched\ndescription: Dispatched one\n---\n\nBody"
    );
    const result = listIlluminations(tmpDir, "open");
    expect(result).toContain("T1000-open.md");
    expect(result).not.toContain("T1100-dispatched.md");
  });

  it("treats files without status field as open", () => {
    const illumDir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(illumDir, { recursive: true });
    writeFileSync(
      join(illumDir, "T0900-legacy.md"),
      "---\ndate: 2026-04-12\ndescription: Legacy file\n---\n\nBody"
    );
    const result = listIlluminations(tmpDir, "open");
    expect(result).toContain("T0900-legacy.md");
  });

  it("returns all illuminations when status omitted", () => {
    const illumDir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(illumDir, { recursive: true });
    writeFileSync(
      join(illumDir, "T1000-open.md"),
      "---\ndate: 2026-04-12\nstatus: open\ndescription: Open\n---\n\nBody"
    );
    writeFileSync(
      join(illumDir, "T1100-dispatched.md"),
      "---\ndate: 2026-04-12\nstatus: dispatched\ndescription: Dispatched\n---\n\nBody"
    );
    const result = listIlluminations(tmpDir);
    expect(result).toContain("T1000-open.md");
    expect(result).toContain("T1100-dispatched.md");
  });

  it("reads from archive/ when status is archived", () => {
    const archiveDir = join(tmpDir, "meditations", "illuminations", "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "T3000-archived.md"),
      "---\ndate: 2026-04-12\nstatus: archived\ndescription: Archived insight\n---\n\nBody"
    );
    // Top-level dir intentionally has a non-archived file that should NOT show up
    const topDir = join(tmpDir, "meditations", "illuminations");
    writeFileSync(
      join(topDir, "T3001-open.md"),
      "---\ndate: 2026-04-12\nstatus: open\ndescription: Open one\n---\n\nBody"
    );
    const result = listIlluminations(tmpDir, "archived");
    expect(result).toContain("T3000-archived.md");
    expect(result).toContain("Archived insight");
    expect(result).not.toContain("T3001-open.md");
  });

  it("returns no-illuminations message when archive/ does not exist", () => {
    // Top-level exists, but archive/ subdir does not
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
    const result = listIlluminations(tmpDir, "archived");
    expect(result).toBe("No illuminations found.");
  });

  it("returns no-illuminations message when archive/ exists but is empty", () => {
    mkdirSync(join(tmpDir, "meditations", "illuminations", "archive"), { recursive: true });
    const result = listIlluminations(tmpDir, "archived");
    expect(result).toBe("No illuminations found.");
  });

  it("status=open continues to read top-level dir, ignoring archive/", () => {
    const archiveDir = join(tmpDir, "meditations", "illuminations", "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "T3100-archived.md"),
      "---\ndate: 2026-04-12\nstatus: archived\ndescription: Archived\n---\n\nBody"
    );
    const topDir = join(tmpDir, "meditations", "illuminations");
    writeFileSync(
      join(topDir, "T3101-open.md"),
      "---\ndate: 2026-04-12\nstatus: open\ndescription: Open\n---\n\nBody"
    );
    const result = listIlluminations(tmpDir, "open");
    expect(result).toContain("T3101-open.md");
    expect(result).not.toContain("T3100-archived.md");
  });

  it("status omitted continues to read top-level dir, ignoring archive/", () => {
    const archiveDir = join(tmpDir, "meditations", "illuminations", "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "T3200-archived.md"),
      "---\ndate: 2026-04-12\nstatus: archived\ndescription: Archived\n---\n\nBody"
    );
    const topDir = join(tmpDir, "meditations", "illuminations");
    writeFileSync(
      join(topDir, "T3201-open.md"),
      "---\ndate: 2026-04-12\nstatus: open\ndescription: Open\n---\n\nBody"
    );
    const result = listIlluminations(tmpDir);
    expect(result).toContain("T3201-open.md");
    expect(result).not.toContain("T3200-archived.md");
  });
});

describe("markImplemented", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-test-")));
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeIlluminationFile(filename: string, frontmatter: string, body: string) {
    const content = `---\n${frontmatter}\n---\n\n${body}`;
    writeFileSync(join(tmpDir, "meditations", "illuminations", filename), content);
  }

  it("transitions dispatched → implemented", () => {
    writeIlluminationFile("insight.md", "status: dispatched", "# Body");
    const result = markImplemented(tmpDir, "insight.md");
    expect(result).toEqual({
      success: true,
      filename: "insight.md",
      previous_status: "dispatched",
      new_status: "implemented",
    });
    const content = readFileSync(join(tmpDir, "meditations", "illuminations", "insight.md"), "utf-8");
    expect(content).toContain("status: implemented");
  });

  it("transitions open → implemented", () => {
    writeIlluminationFile("open-insight.md", "status: open", "# Open Body");
    const result = markImplemented(tmpDir, "open-insight.md");
    expect(result).toEqual({
      success: true,
      filename: "open-insight.md",
      previous_status: "open",
      new_status: "implemented",
    });
  });

  it("rejects already-implemented illumination", () => {
    writeIlluminationFile("done.md", "status: implemented", "# Done");
    const result = markImplemented(tmpDir, "done.md");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Cannot mark as implemented");
      expect(result.error).toContain("implemented");
    }
  });

  it("rejects archived illumination", () => {
    writeIlluminationFile("archived.md", "status: archived", "# Archived");
    const result = markImplemented(tmpDir, "archived.md");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Cannot mark as implemented");
      expect(result.error).toContain("archived");
    }
  });

  it("rejects path traversal filename", () => {
    const result = markImplemented(tmpDir, "../../../etc/passwd");
    expect(result.success).toBe(false);
  });

  it("returns error when file not found", () => {
    const result = markImplemented(tmpDir, "nonexistent.md");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not found");
    }
  });

  it("preserves body content unchanged", () => {
    const body = "# My Insight\n\nSome detailed content here.\n\n- bullet 1\n- bullet 2";
    writeIlluminationFile("preserve.md", "status: dispatched", body);
    markImplemented(tmpDir, "preserve.md");
    const content = readFileSync(join(tmpDir, "meditations", "illuminations", "preserve.md"), "utf-8");
    expect(content).toContain(body);
  });

  it("adds implemented_at as UTC date in YYYY-MM-DD format", () => {
    writeIlluminationFile("dated.md", "status: open", "# Body");
    markImplemented(tmpDir, "dated.md");
    const content = readFileSync(join(tmpDir, "meditations", "illuminations", "dated.md"), "utf-8");
    const today = new Date().toISOString().slice(0, 10);
    expect(content).toContain(`implemented_at: ${today}`);
    expect(content).toMatch(/implemented_at: \d{4}-\d{2}-\d{2}/);
  });

  it("auto-commits the file after writing (git add then git commit)", () => {
    mockExecSync.mockReset();
    writeIlluminationFile("commit-impl.md", "status: dispatched", "# Body");
    const result = markImplemented(tmpDir, "commit-impl.md");
    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    const addCall = mockExecSync.mock.calls[0][0] as string;
    const commitCall = mockExecSync.mock.calls[1][0] as string;
    expect(addCall).toContain("git -C");
    expect(addCall).toContain(tmpDir);
    expect(addCall).toContain("add");
    expect(addCall).toContain("commit-impl.md");
    expect(commitCall).toContain("git -C");
    expect(commitCall).toContain("commit");
    expect(commitCall).toContain("meditate: mark commit-impl.md implemented");
  });

  it("returns success even when git commands fail (fail-open)", () => {
    mockExecSync.mockClear();
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    writeIlluminationFile("fail-open-impl.md", "status: open", "# Body");
    const result = markImplemented(tmpDir, "fail-open-impl.md");
    expect(result.success).toBe(true);
  });
});

describe("markDispatched", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-test-")));
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeIlluminationFile(filename: string, frontmatter: string, body: string) {
    const content = `---\n${frontmatter}\n---\n\n${body}`;
    writeFileSync(join(tmpDir, "meditations", "illuminations", filename), content);
  }

  it("transitions open to dispatched", () => {
    writeIlluminationFile(
      "T1300-open.md",
      "date: 2026-04-12\nstatus: open\ndescription: An open issue",
      "Body content."
    );

    const result = markDispatched(tmpDir, "T1300-open.md", "docs/superpowers/specs/2026-04-12-test.md");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.previous_status).toBe("open");
      expect(result.new_status).toBe("dispatched");
    }

    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "T1300-open.md"),
      "utf-8"
    );
    expect(written).toMatch(/status: dispatched/);
    expect(written).toMatch(/dispatched_at: \d{4}-\d{2}-\d{2}/);
    expect(written).toMatch(/plan_path: docs\/superpowers\/specs\/2026-04-12-test\.md/);
    expect(written).toContain("Body content.");
  });

  it("rejects already-dispatched illumination", () => {
    writeIlluminationFile(
      "T1400-dispatched.md",
      "date: 2026-04-12\nstatus: dispatched\ndescription: Already dispatched",
      "Body."
    );

    const result = markDispatched(tmpDir, "T1400-dispatched.md", "some/path.md");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("dispatched");
    }
  });

  it("rejects implemented illumination", () => {
    writeIlluminationFile(
      "T1500-impl.md",
      "date: 2026-04-12\nstatus: implemented\ndescription: Done",
      "Body."
    );

    const result = markDispatched(tmpDir, "T1500-impl.md", "some/path.md");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("implemented");
    }
  });

  it("rejects archived illumination", () => {
    writeIlluminationFile(
      "T1600-archived.md",
      "date: 2026-04-12\nstatus: archived\ndescription: Old",
      "Body."
    );

    const result = markDispatched(tmpDir, "T1600-archived.md", "some/path.md");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("archived");
    }
  });

  it("returns error when file not found", () => {
    const result = markDispatched(tmpDir, "T9999-nonexistent.md", "some/path.md");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not found");
    }
  });

  it("treats files without status field as open", () => {
    writeIlluminationFile(
      "T1700-legacy.md",
      "date: 2026-04-12\ndescription: Legacy file",
      "Body."
    );

    const result = markDispatched(tmpDir, "T1700-legacy.md", "some/plan.md");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.previous_status).toBe("open");
      expect(result.new_status).toBe("dispatched");
    }
  });

  it("preserves body content unchanged", () => {
    const body = "# Analysis\n\nMultiple paragraphs.\n\n- Item 1\n- Item 2";
    writeIlluminationFile(
      "T1800-preserve.md",
      "date: 2026-04-12\nstatus: open\ndescription: Preserve test",
      body
    );

    markDispatched(tmpDir, "T1800-preserve.md", "some/path.md");

    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "T1800-preserve.md"),
      "utf-8"
    );
    expect(written).toContain(body);
  });

  it("auto-commits the file after writing (git add then git commit)", () => {
    mockExecSync.mockReset();
    writeIlluminationFile(
      "T1900-commit-dispatch.md",
      "date: 2026-04-12\nstatus: open\ndescription: Commit test",
      "Body."
    );
    const result = markDispatched(tmpDir, "T1900-commit-dispatch.md", "docs/superpowers/plans/foo.md");
    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    const addCall = mockExecSync.mock.calls[0][0] as string;
    const commitCall = mockExecSync.mock.calls[1][0] as string;
    expect(addCall).toContain("git -C");
    expect(addCall).toContain(tmpDir);
    expect(addCall).toContain("add");
    expect(addCall).toContain("T1900-commit-dispatch.md");
    expect(commitCall).toContain("commit");
    expect(commitCall).toContain("meditate: mark T1900-commit-dispatch.md dispatched");
  });

  it("returns success even when git commands fail (fail-open)", () => {
    mockExecSync.mockClear();
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    writeIlluminationFile(
      "T1950-fail-open.md",
      "date: 2026-04-12\nstatus: open\ndescription: Fail-open test",
      "Body."
    );
    const result = markDispatched(tmpDir, "T1950-fail-open.md", "some/plan.md");
    expect(result.success).toBe(true);
  });
});

describe("markArchived", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-test-")));
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeIlluminationFile(filename: string, frontmatter: string, body: string) {
    const content = `---\n${frontmatter}\n---\n\n${body}`;
    writeFileSync(join(tmpDir, "meditations", "illuminations", filename), content);
  }

  it("archives an open illumination", () => {
    writeIlluminationFile(
      "T2000-open.md",
      "date: 2026-04-12\nstatus: open\ndescription: Stale issue",
      "Body."
    );

    const result = markArchived(tmpDir, "T2000-open.md", "No longer relevant");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.previous_status).toBe("open");
      expect(result.new_status).toBe("archived");
      expect(result.archive_path).toContain("archive/T2000-open.md");
    }

    // File moved to archive
    expect(existsSync(join(tmpDir, "meditations", "illuminations", "T2000-open.md"))).toBe(false);
    expect(existsSync(join(tmpDir, "meditations", "illuminations", "archive", "T2000-open.md"))).toBe(true);

    // Frontmatter updated
    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "archive", "T2000-open.md"),
      "utf-8"
    );
    expect(written).toMatch(/status: archived/);
    expect(written).toMatch(/archived_at: \d{4}-\d{2}-\d{2}/);
    expect(written).toMatch(/archive_reason: No longer relevant/);
  });

  it("archives an implemented illumination", () => {
    writeIlluminationFile(
      "T2100-impl.md",
      "date: 2026-04-12\nstatus: implemented\ndescription: Done",
      "Body."
    );

    const result = markArchived(tmpDir, "T2100-impl.md", "Completed and verified");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.previous_status).toBe("implemented");
      expect(result.new_status).toBe("archived");
    }
  });

  it("archives a dispatched illumination", () => {
    writeIlluminationFile(
      "T2200-dispatched.md",
      "date: 2026-04-12\nstatus: dispatched\ndescription: In progress",
      "Body."
    );

    const result = markArchived(tmpDir, "T2200-dispatched.md", "Plan abandoned");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.previous_status).toBe("dispatched");
    }
  });

  it("rejects already-archived illumination", () => {
    writeIlluminationFile(
      "T2300-archived.md",
      "date: 2026-04-12\nstatus: archived\ndescription: Old",
      "Body."
    );

    const result = markArchived(tmpDir, "T2300-archived.md", "Already done");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("archived");
    }
  });

  it("returns error when file not found", () => {
    const result = markArchived(tmpDir, "T9999-nonexistent.md", "Gone");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not found");
    }
  });

  it("creates archive directory if it does not exist", () => {
    writeIlluminationFile(
      "T2400-new-archive.md",
      "date: 2026-04-12\nstatus: open\ndescription: Test",
      "Body."
    );

    expect(existsSync(join(tmpDir, "meditations", "illuminations", "archive"))).toBe(false);

    markArchived(tmpDir, "T2400-new-archive.md", "Testing archive creation");

    expect(existsSync(join(tmpDir, "meditations", "illuminations", "archive"))).toBe(true);
  });

  it("preserves body content unchanged", () => {
    const body = "# Deep Analysis\n\nParagraphs.\n\n- List";
    writeIlluminationFile(
      "T2500-preserve.md",
      "date: 2026-04-12\nstatus: open\ndescription: Preserve test",
      body
    );

    markArchived(tmpDir, "T2500-preserve.md", "Done");

    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "archive", "T2500-preserve.md"),
      "utf-8"
    );
    expect(written).toContain(body);
  });

  it("auto-commits the rename as one commit (add deleted path, add new path, commit)", () => {
    mockExecSync.mockReset();
    writeIlluminationFile(
      "T2600-commit-archive.md",
      "date: 2026-04-12\nstatus: open\ndescription: Archive commit test",
      "Body."
    );
    const result = markArchived(tmpDir, "T2600-commit-archive.md", "Stale");
    expect(result.success).toBe(true);
    // Three execSync calls: add original (now deleted), add archive path, commit.
    expect(mockExecSync).toHaveBeenCalledTimes(3);
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("git -C");
    expect(calls[0]).toContain("add");
    expect(calls[0]).toContain("T2600-commit-archive.md");
    expect(calls[0]).not.toContain("archive/T2600-commit-archive.md");
    expect(calls[1]).toContain("git -C");
    expect(calls[1]).toContain("add");
    expect(calls[1]).toContain("archive/T2600-commit-archive.md");
    expect(calls[2]).toContain("commit");
    expect(calls[2]).toContain("meditate: archive T2600-commit-archive.md");
  });

  it("returns success even when git commands fail (fail-open)", () => {
    mockExecSync.mockClear();
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    writeIlluminationFile(
      "T2700-archive-fail-open.md",
      "date: 2026-04-12\nstatus: open\ndescription: Fail-open archive",
      "Body."
    );
    const result = markArchived(tmpDir, "T2700-archive-fail-open.md", "Reason");
    expect(result.success).toBe(true);
    // File still moved to archive even when git fails
    expect(existsSync(join(tmpDir, "meditations", "illuminations", "archive", "T2700-archive-fail-open.md"))).toBe(true);
  });
});

describe("listPlans", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-plan-test-")));
    mkdirSync(join(tmpDir, "docs", "superpowers", "plans"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePlanFile(filename: string, frontmatter: string | null, body: string) {
    const fm = frontmatter === null ? "" : `---\n${frontmatter}\n---\n`;
    writeFileSync(join(tmpDir, "docs", "superpowers", "plans", filename), fm + body);
  }

  it("returns sentinel when directory is empty", () => {
    expect(listPlans(tmpDir)).toBe("No plans found.");
  });
});
