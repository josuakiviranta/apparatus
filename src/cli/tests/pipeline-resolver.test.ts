import { describe, it, expect } from "vitest";
import { join } from "path";
import { resolvePipelineArg, getPipelinesDir, isNameShorthand } from "../lib/pipeline-resolver.js";

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
  it("resolves a plain name against project pipelines dir", () => {
    const result = resolvePipelineArg("review", "/my-app");
    expect(result).toBe(join("/my-app", "pipelines", "review.dot"));
  });

  it("resolves a name with .dot omitted", () => {
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

describe("getPipelinesDir", () => {
  it("returns pipelines subfolder of project", () => {
    expect(getPipelinesDir("/my-app")).toBe(join("/my-app", "pipelines"));
  });
});
