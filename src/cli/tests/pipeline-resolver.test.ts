import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";

vi.mock("fs", () => ({ existsSync: vi.fn() }));
vi.mock("../lib/assets.js", () => ({
  resolveBundledPipeline: (name: string) => `/dist/pipelines/${name}/pipeline.dot`,
}));

import { existsSync } from "fs";
import { resolvePipelineArg, getPipelinesDir, isNameShorthand } from "../lib/pipeline-resolver.js";

const mockExists = existsSync as ReturnType<typeof vi.fn>;

describe("isNameShorthand", () => {
  it("returns true for plain names", () => {
    expect(isNameShorthand("review")).toBe(true);
    expect(isNameShorthand("my-workflow")).toBe(true);
    expect(isNameShorthand("my_workflow")).toBe(true);
  });

  it("returns false if arg contains path separator", () => {
    expect(isNameShorthand("./review.dot")).toBe(false);
    expect(isNameShorthand("pipelines/review.dot")).toBe(false);
    expect(isNameShorthand("/abs/path.dot")).toBe(false);
  });

  it("returns false if arg has .dot extension", () => {
    expect(isNameShorthand("review.dot")).toBe(false);
  });
});

describe("resolvePipelineArg", () => {
  beforeEach(() => mockExists.mockReturnValue(false));

  it("resolves a plain name to project-local path when it exists", () => {
    mockExists.mockImplementation((p: unknown) =>
      typeof p === "string" && p.includes(join("/my-app", ".ralph", "pipelines", "review.dot"))
    );
    const result = resolvePipelineArg("review", "/my-app");
    expect(result).toBe(join("/my-app", ".ralph", "pipelines", "review.dot"));
  });

  it("resolves a name with .dot omitted", () => {
    mockExists.mockImplementation((p: unknown) =>
      typeof p === "string" && p.includes(join("/my-app", ".ralph", "pipelines", "review.dot"))
    );
    const result = resolvePipelineArg("review", "/my-app");
    expect(result.endsWith(".dot")).toBe(true);
  });

  it("returns raw path for explicit path arguments", () => {
    const result = resolvePipelineArg("./pipelines/review.dot", "/my-app");
    expect(result).toBe(join(process.cwd(), "pipelines", "review.dot"));
  });

  it("throws on invalid name characters", () => {
    expect(() => resolvePipelineArg("bad name!", "/my-app")).toThrow(/invalid/i);
    expect(() => resolvePipelineArg("bad/name", "/my-app")).not.toThrow(); // treated as path, not name
  });
});

describe("resolvePipelineArg bundled fallback", () => {
  beforeEach(() => mockExists.mockReturnValue(false));

  it("returns folder-form bundled path when project and user paths do not exist", () => {
    const result = resolvePipelineArg("implement", "/my/project");
    expect(result).toBe("/dist/pipelines/implement/pipeline.dot");
  });

  it("prefers project-local pipeline when it exists", () => {
    mockExists.mockImplementation((p: unknown) =>
      typeof p === "string" && p.includes("/my/project/.ralph/pipelines/implement.dot")
    );
    const result = resolvePipelineArg("implement", "/my/project");
    expect(result).toContain("/my/project/.ralph/pipelines/implement.dot");
  });

  it("returns absolute path unchanged for non-shorthand args", () => {
    const result = resolvePipelineArg("/absolute/path/to/pipeline.dot", "/my/project");
    expect(result).toBe("/absolute/path/to/pipeline.dot");
  });
});

describe("resolvePipelineArg folder-form lookup (Chunk 4: per-pipeline folder)", () => {
  beforeEach(() => mockExists.mockReturnValue(false));

  it("returns <project>/.ralph/pipelines/<name>/pipeline.dot when folder-form exists and flat-form does not", () => {
    const folderPath = join("/my-app", ".ralph", "pipelines", "janitor", "pipeline.dot");
    mockExists.mockImplementation((p: unknown) =>
      typeof p === "string" && p === folderPath
    );
    expect(resolvePipelineArg("janitor", "/my-app")).toBe(folderPath);
  });

  it("prefers folder-form over flat-form when BOTH exist (folder = SSoT, Decision 1)", () => {
    const folderPath = join("/my-app", ".ralph", "pipelines", "janitor", "pipeline.dot");
    const flatPath = join("/my-app", ".ralph", "pipelines", "janitor.dot");
    mockExists.mockImplementation((p: unknown) =>
      typeof p === "string" && (p === folderPath || p === flatPath)
    );
    expect(resolvePipelineArg("janitor", "/my-app")).toBe(folderPath);
  });

  it("falls through to flat-form when only the flat <name>.dot exists (back-compat)", () => {
    const flatPath = join("/my-app", ".ralph", "pipelines", "legacy.dot");
    mockExists.mockImplementation((p: unknown) =>
      typeof p === "string" && p === flatPath
    );
    expect(resolvePipelineArg("legacy", "/my-app")).toBe(flatPath);
  });
});

describe("getPipelinesDir", () => {
  it("returns .ralph/pipelines subfolder of project", () => {
    expect(getPipelinesDir("/my-app")).toBe(join("/my-app", ".ralph", "pipelines"));
  });
});
