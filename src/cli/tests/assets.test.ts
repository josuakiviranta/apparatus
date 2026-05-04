import { existsSync, readdirSync } from "fs";
import { describe, it, expect } from "vitest";
import { getBundledPipelinesDir, getIlluminationServerPath, getMetaMeditationsDir } from "../lib/assets";

describe("assets", () => {
  it("getIlluminationServerPath returns a path ending in illumination-server.ts or .js", () => {
    const p = getIlluminationServerPath();
    expect(p).toMatch(/illumination-server\.(ts|js)$/);
  });

  it("getMetaMeditationsDir returns a path to the stimulus library with all lens files present", () => {
    const p = getMetaMeditationsDir();
    expect(p).toMatch(/\.ralph\/meditations\/stimuli$/);
    expect(existsSync(p)).toBe(true);
    const files = readdirSync(p).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(29);
    expect(files).toContain("red-green-tdd-is-non-negotiable.md");
  });

  it("getBundledPipelinesDir resolves to an existing directory", () => {
    const p = getBundledPipelinesDir();
    expect(typeof p).toBe("string");
    expect(existsSync(p)).toBe(true);
  });
});
