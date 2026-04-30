import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { getBundledPipelinesDir, resolveBundledPipeline } from "../lib/assets.js";

describe("getBundledPipelinesDir", () => {
  it("returns a path to a directory that exists", () => {
    const dir = getBundledPipelinesDir();
    expect(existsSync(dir)).toBe(true);
  });
});

describe("resolveBundledPipeline", () => {
  it("resolves to <pipelinesDir>/<name>/pipeline.dot", () => {
    const path = resolveBundledPipeline("meditate");
    expect(path.endsWith("meditate/pipeline.dot")).toBe(true);
  });
  it("throws a clear error when the pipeline is missing", () => {
    expect(() => resolveBundledPipeline("does-not-exist")).toThrow(/pipeline/i);
    expect(() => resolveBundledPipeline("does-not-exist")).toThrow(/does-not-exist/);
  });
});
