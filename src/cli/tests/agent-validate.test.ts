import { describe, it, expect } from "vitest";
import { validateAgentConfig } from "../lib/agent.js";
import { parseAgentFile } from "../lib/agent-registry.js";

describe("validateAgentConfig — deep loop fields", () => {
  it("propagates loop:true into the returned config", () => {
    const cfg = validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      loop: true,
    });
    expect(cfg.loop).toBe(true);
  });

  it("propagates maxIterations into the returned config", () => {
    const cfg = validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      loop: true,
      maxIterations: 25,
    });
    expect(cfg.maxIterations).toBe(25);
  });

  it("omits both fields when not provided", () => {
    const cfg = validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
    });
    expect(cfg.loop).toBeUndefined();
    expect(cfg.maxIterations).toBeUndefined();
  });

  it("rejects non-boolean loop", () => {
    expect(() => validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      loop: "yes" as any,
    })).toThrow(/loop must be a boolean/i);
  });

  it("rejects non-integer maxIterations", () => {
    expect(() => validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      maxIterations: 1.5 as any,
    })).toThrow(/maxIterations must be a non-negative integer/i);
  });

  it("rejects negative maxIterations", () => {
    expect(() => validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      maxIterations: -1 as any,
    })).toThrow(/maxIterations must be a non-negative integer/i);
  });

  it("accepts maxIterations=0 (back-compat: maps to Infinity at runtime)", () => {
    const cfg = validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      maxIterations: 0,
    });
    expect(cfg.maxIterations).toBe(0);
  });
});

describe("parseAgentFile — deep loop fields round-trip", () => {
  it("reads loop and maxIterations from frontmatter", () => {
    const cfg = parseAgentFile([
      "---",
      "name: looper",
      "description: x",
      "loop: true",
      "maxIterations: 50",
      "outputs:",
      "  done: boolean",
      "---",
      "Body.",
    ].join("\n"));
    expect(cfg.loop).toBe(true);
    expect(cfg.maxIterations).toBe(50);
    expect(cfg.outputs?.done).toBe("boolean");
  });
});
