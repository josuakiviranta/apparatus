import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { getBundledTemplatesDir, resolveBundledTemplate } from "../lib/assets.js";

describe("getBundledTemplatesDir", () => {
  it("returns a path to a directory that exists", () => {
    const dir = getBundledTemplatesDir();
    expect(existsSync(dir)).toBe(true);
  });
});

describe("resolveBundledTemplate", () => {
  it("resolves to <templatesDir>/<name>/pipeline.dot", () => {
    const path = resolveBundledTemplate("pipeline-create");
    expect(path.endsWith("pipeline-create/pipeline.dot")).toBe(true);
  });
  it("throws a clear error when the template is missing", () => {
    expect(() => resolveBundledTemplate("does-not-exist")).toThrow(/template/i);
    expect(() => resolveBundledTemplate("does-not-exist")).toThrow(/does-not-exist/);
  });
});
