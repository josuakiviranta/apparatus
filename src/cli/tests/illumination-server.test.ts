import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateFilename, writeIllumination, assertWithinRoot, readFile, validateGlobPattern, globFiles, projectTree, listMetaMeditations, readMetaMeditation } from "../mcp/illumination-server";

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

  it("skips dist, build, coverage, .next, .turbo, __pycache__, .cache", () => {
    for (const dir of ["dist", "build", "coverage", ".next", ".turbo", "__pycache__", ".cache"]) {
      mkdirSync(join(tmpDir, dir));
    }
    const result = projectTree(tmpDir);
    for (const dir of ["dist", "build", "coverage", ".next", ".turbo", "__pycache__", ".cache"]) {
      expect(result).not.toContain(dir);
    }
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
