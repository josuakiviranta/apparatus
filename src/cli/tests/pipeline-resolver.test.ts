import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";

vi.mock("fs", () => ({ existsSync: vi.fn() }));
vi.mock("../lib/assets.js", () => ({
  getBundledPipelinePath: (name: string) => `/dist/pipelines/${name}.dot`,
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
      typeof p === "string" && p.includes(join("/my-app", "pipelines", "review.dot"))
    );
    const result = resolvePipelineArg("review", "/my-app");
    expect(result).toBe(join("/my-app", "pipelines", "review.dot"));
  });

  it("resolves a name with .dot omitted", () => {
    mockExists.mockImplementation((p: unknown) =>
      typeof p === "string" && p.includes(join("/my-app", "pipelines", "review.dot"))
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

  it("returns bundled path when project and user paths do not exist", () => {
    const result = resolvePipelineArg("implement", "/my/project");
    expect(result).toBe("/dist/pipelines/implement.dot");
  });

  it("prefers project-local pipeline when it exists", () => {
    mockExists.mockImplementation((p: unknown) =>
      typeof p === "string" && p.includes("/my/project/pipelines/implement.dot")
    );
    const result = resolvePipelineArg("implement", "/my/project");
    expect(result).toContain("/my/project/pipelines/implement.dot");
  });

  it("returns absolute path unchanged for non-shorthand args", () => {
    const result = resolvePipelineArg("/absolute/path/to/pipeline.dot", "/my/project");
    expect(result).toBe("/absolute/path/to/pipeline.dot");
  });
});

describe("getPipelinesDir", () => {
  it("returns pipelines subfolder of project", () => {
    expect(getPipelinesDir("/my-app")).toBe(join("/my-app", "pipelines"));
  });
});

describe("getBundledPipelinePath (assets.ts)", () => {
  it("resolves implement name to a .dot path", async () => {
    const { getBundledPipelinePath } = await import("../lib/assets.js");
    const result = getBundledPipelinePath("implement");
    expect(result).toContain("implement.dot");
  });
});
