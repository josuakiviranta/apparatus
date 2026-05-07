import { existsSync } from "fs";
import { describe, it, expect } from "vitest";
import { getBundledPipelinesDir, getIlluminationServerPath } from "../lib/assets";

describe("assets", () => {
  it("getIlluminationServerPath returns a path ending in illumination-server.ts or .js", () => {
    const p = getIlluminationServerPath();
    expect(p).toMatch(/illumination-server\.(ts|js)$/);
  });

  it("getBundledPipelinesDir resolves to an existing directory", () => {
    const p = getBundledPipelinesDir();
    expect(typeof p).toBe("string");
    expect(existsSync(p)).toBe(true);
  });
});
