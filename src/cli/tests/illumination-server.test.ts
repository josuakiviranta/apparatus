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

import { validateFilename, validateSlug, composeIlluminationFilename, writeIllumination, assertWithinRoot, readFile, validateGlobPattern, globFiles, projectTree, listMetaMeditations, readMetaMeditation, listIlluminations, listPlans, consume, consumePlan } from "../mcp/illumination-server";

let tmpDir: string;

beforeEach(() => {
  tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-test-")));
  mockExecSync.mockReset();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("validateSlug", () => {
  it("accepts kebab-case slug", () => {
    expect(validateSlug("janitor-doc-drift")).toBeNull();
    expect(validateSlug("my-insight")).toBeNull();
    expect(validateSlug("a")).toBeNull();
    expect(validateSlug("v2-thing")).toBeNull();
  });

  it("rejects empty slug", () => {
    expect(validateSlug("")).not.toBeNull();
  });

  it("rejects uppercase letters", () => {
    expect(validateSlug("Janitor-Doc")).not.toBeNull();
  });

  it("rejects underscores or other separators", () => {
    expect(validateSlug("my_insight")).not.toBeNull();
    expect(validateSlug("my insight")).not.toBeNull();
  });

  it("rejects leading hyphen or non-alphanumeric start", () => {
    expect(validateSlug("-foo")).not.toBeNull();
  });

  it("rejects path components or extensions", () => {
    expect(validateSlug("my/insight")).not.toBeNull();
    expect(validateSlug("foo.md")).not.toBeNull();
  });
});

describe("composeIlluminationFilename", () => {
  it("prepends YYYY-MM-DDTHHMM- prefix and appends .md", () => {
    const fixed = new Date(2026, 3, 26, 12, 57); // April 26 12:57 local
    expect(composeIlluminationFilename("janitor-doc-drift", fixed)).toBe(
      "2026-04-26T1257-janitor-doc-drift.md",
    );
  });

  it("zero-pads month, day, hour, minute", () => {
    const fixed = new Date(2026, 0, 5, 3, 9); // Jan 5 03:09
    expect(composeIlluminationFilename("foo", fixed)).toBe("2026-01-05T0309-foo.md");
  });

  it("throws on invalid slug", () => {
    expect(() => composeIlluminationFilename("Bad Slug")).toThrow();
    expect(() => composeIlluminationFilename("")).toThrow();
  });
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
  it("writes content to .ralph/meditations/illuminations/<filename>", () => {
    const result = writeIllumination(tmpDir, "2026-04-04T1430-test.md", "A test insight", "# Hello");
    const expected = join(tmpDir, ".ralph", "meditations", "illuminations", "2026-04-04T1430-test.md");
    expect(result).toBe(expected);
    expect(readFileSync(expected, "utf8")).toContain("# Hello");
  });

  it("overwrites an existing file without error", () => {
    writeIllumination(tmpDir, "test.md", "First version", "v1");
    const result = writeIllumination(tmpDir, "test.md", "Second version", "v2");
    expect(readFileSync(result, "utf8")).toContain("v2");
  });

  it("creates .ralph/meditations/illuminations/ directory if absent", () => {
    writeIllumination(tmpDir, "test.md", "Some description", "content");
    expect(existsSync(join(tmpDir, ".ralph", "meditations", "illuminations"))).toBe(true);
  });

  it("throws an error for an invalid filename", () => {
    expect(() => writeIllumination(tmpDir, "bad/name.md", "A description", "content")).toThrow();
  });

  it("prepends YAML frontmatter with date and description", () => {
    writeIllumination(tmpDir, "test.md", "My core insight", "# Body");
    const written = readFileSync(join(tmpDir, ".ralph", "meditations", "illuminations", "test.md"), "utf8");
    const today = new Date().toISOString().slice(0, 10);
    expect(written).toMatch(new RegExp(`^---\\ndate: ${today}\\ndescription: My core insight\\n---\\n`));
  });

  it("places the content body after the frontmatter separator", () => {
    writeIllumination(tmpDir, "test.md", "Insight here", "# Body\nParagraph");
    const written = readFileSync(join(tmpDir, ".ralph", "meditations", "illuminations", "test.md"), "utf8");
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
    mkdirSync(join(tmpDir, ".ralph", "meditations", "illuminations"), { recursive: true });
    const result = listIlluminations(tmpDir);
    expect(result).toBe("No illuminations found.");
  });

  it("returns filename and description for a file with frontmatter", () => {
    const dir = join(tmpDir, ".ralph", "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-04-08T0900-my-insight.md"), "---\ndate: 2026-04-08\ndescription: Something important.\n---\n\n# My Insight\n\nBody.");
    const result = listIlluminations(tmpDir);
    expect(result).toBe("2026-04-08T0900-my-insight.md — Something important.");
  });

  it("shows (no description) for a file without frontmatter", () => {
    const dir = join(tmpDir, ".ralph", "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "old-insight.md"), "# Old Insight\n\nNo frontmatter here.");
    const result = listIlluminations(tmpDir);
    expect(result).toBe("old-insight.md — (no description)");
  });

  it("shows (no description) for a file with frontmatter missing description field", () => {
    const dir = join(tmpDir, ".ralph", "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "partial.md"), "---\ndate: 2026-04-08\n---\n\n# Partial");
    const result = listIlluminations(tmpDir);
    expect(result).toBe("partial.md — (no description)");
  });

  it("lists multiple files sorted by filename", () => {
    const dir = join(tmpDir, ".ralph", "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-04-08T1100-second.md"), "---\ndate: 2026-04-08\ndescription: Second insight.\n---\n\n# Second");
    writeFileSync(join(dir, "2026-04-08T0900-first.md"), "---\ndate: 2026-04-08\ndescription: First insight.\n---\n\n# First");
    const result = listIlluminations(tmpDir);
    expect(result).toBe(
      "2026-04-08T0900-first.md — First insight.\n2026-04-08T1100-second.md — Second insight."
    );
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

  it("no filter returns all files including no-frontmatter", () => {
    writePlanFile("a-pending.md", "status: pending", "# Plan A\n");
    writePlanFile("b-implemented.md", "status: implemented", "# Plan B\n");
    writePlanFile("c-no-fm.md", null, "# Plan C\n");
    const result = listPlans(tmpDir);
    expect(result).toBe(
      "a-pending.md — Plan A\nb-implemented.md — Plan B\nc-no-fm.md — Plan C",
    );
  });

  it("falls back to (no description) when body has no H1", () => {
    writePlanFile("d-no-h1.md", "status: pending", "Body without heading\n");
    const result = listPlans(tmpDir);
    expect(result).toBe("d-no-h1.md — (no description)");
  });
});

describe("consume", () => {
  function seedIllumination(filename: string, body = "body"): string {
    const dir = join(tmpDir, ".ralph", "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, filename);
    writeFileSync(filePath, `---\ndate: 2026-04-30\ndescription: test\n---\n\n${body}`, "utf8");
    return filePath;
  }

  it("deletes the illumination file from disk", () => {
    const filePath = seedIllumination("2026-04-30T1200-x.md");
    consume(tmpDir, "2026-04-30T1200-x.md", "implemented");
    expect(existsSync(filePath)).toBe(false);
  });

  it("commits with reason in the message — implemented", () => {
    seedIllumination("2026-04-30T1200-x.md");
    consume(tmpDir, "2026-04-30T1200-x.md", "implemented");
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((cmd) => cmd.includes("git -C") && cmd.includes("rm"))).toBe(true);
    expect(calls.some((cmd) => cmd.includes("commit -m") && cmd.includes("(implemented)"))).toBe(true);
  });

  it("commits with reason in the message — declined", () => {
    seedIllumination("2026-04-30T1200-y.md");
    consume(tmpDir, "2026-04-30T1200-y.md", "declined");
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((cmd) => cmd.includes("commit -m") && cmd.includes("(declined)"))).toBe(true);
  });

  it("rejects invalid filenames", () => {
    expect(() => consume(tmpDir, "../oops", "declined")).toThrow(/Invalid filename/);
  });

  it("rejects unknown reasons", () => {
    seedIllumination("2026-04-30T1200-z.md");
    expect(() => consume(tmpDir, "2026-04-30T1200-z.md", "archived" as never)).toThrow(/reason/i);
  });

  it("returns success descriptor with consumed filename", () => {
    seedIllumination("2026-04-30T1200-r.md");
    const result = consume(tmpDir, "2026-04-30T1200-r.md", "implemented");
    expect(result).toEqual({ success: true, filename: "2026-04-30T1200-r.md", reason: "implemented" });
  });

  it("returns failure when file does not exist", () => {
    const result = consume(tmpDir, "2026-04-30T1200-missing.md", "implemented");
    expect(result).toEqual({ success: false, error: "Illumination file not found" });
  });
});

describe("listIlluminations — single-folder semantics", () => {
  it("returns only files in .ralph/meditations/illuminations/ (does not union side folders)", () => {
    const aliveDir = join(tmpDir, ".ralph", "meditations", "illuminations");
    const archivedDir = join(tmpDir, ".ralph", "meditations", "archived-illuminations");
    mkdirSync(aliveDir, { recursive: true });
    mkdirSync(archivedDir, { recursive: true });
    writeFileSync(join(aliveDir, "alive.md"), `---\ndate: 2026-04-30\ndescription: alive one\n---\n`);
    writeFileSync(join(archivedDir, "ghost.md"), `---\ndate: 2026-04-30\ndescription: should not appear\n---\n`);

    const result = listIlluminations(tmpDir);

    expect(result).toContain("alive.md");
    expect(result).not.toContain("ghost.md");
    expect(result).not.toContain("should not appear");
  });

  it("returns the no-illuminations sentinel when folder is empty", () => {
    expect(listIlluminations(tmpDir)).toMatch(/no illuminations found/i);
  });
});

describe("consumePlan", () => {
  function seedPlan(filename: string, body = "# Plan body\n"): string {
    const dir = join(tmpDir, "docs", "superpowers", "plans");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, filename);
    writeFileSync(filePath, body, "utf8");
    return filePath;
  }

  it("deletes the plan file from disk", () => {
    const filePath = seedPlan("2026-05-04-x.md");
    consumePlan(tmpDir, "2026-05-04-x.md", "implemented");
    expect(existsSync(filePath)).toBe(false);
  });

  it("commits with reason in the message — implemented", () => {
    seedPlan("2026-05-04-x.md");
    consumePlan(tmpDir, "2026-05-04-x.md", "implemented");
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((cmd) => cmd.includes("git -C") && cmd.includes("rm"))).toBe(true);
    expect(calls.some((cmd) => cmd.includes("commit -m") && cmd.includes("(implemented)"))).toBe(true);
  });

  it("commits with reason in the message — declined", () => {
    seedPlan("2026-05-04-y.md");
    consumePlan(tmpDir, "2026-05-04-y.md", "declined");
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((cmd) => cmd.includes("commit -m") && cmd.includes("(declined)"))).toBe(true);
  });

  it("rejects invalid filenames", () => {
    expect(() => consumePlan(tmpDir, "../oops", "declined")).toThrow(/Invalid filename/);
  });

  it("rejects unknown reasons", () => {
    seedPlan("2026-05-04-z.md");
    expect(() => consumePlan(tmpDir, "2026-05-04-z.md", "archived" as never)).toThrow(/reason/i);
  });

  it("returns success descriptor with consumed filename", () => {
    seedPlan("2026-05-04-r.md");
    const result = consumePlan(tmpDir, "2026-05-04-r.md", "implemented");
    expect(result).toEqual({ success: true, filename: "2026-05-04-r.md", reason: "implemented" });
  });

  it("returns failure when file does not exist", () => {
    const result = consumePlan(tmpDir, "2026-05-04-missing.md", "implemented");
    expect(result).toEqual({ success: false, error: "Plan file not found" });
  });

  it("does not throw when git commands fail (fail-open, file already removed)", () => {
    const filePath = seedPlan("2026-05-04-fail-open.md");
    mockExecSync.mockImplementation(() => { throw new Error("git not found"); });
    const result = consumePlan(tmpDir, "2026-05-04-fail-open.md", "implemented");
    expect(result).toEqual({ success: true, filename: "2026-05-04-fail-open.md", reason: "implemented" });
    expect(existsSync(filePath)).toBe(false);
  });
});
