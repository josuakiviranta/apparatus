import { describe, it, expect } from "vitest";
import { BaseNodeSchema, AgentNodeSchema } from "../core/schemas.js";

describe("BaseNodeSchema", () => {
  it("accepts a node with only id", () => {
    const result = BaseNodeSchema.safeParse({ id: "n1" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown attributes", () => {
    const result = BaseNodeSchema.safeParse({ id: "n1", tool_commnd: "x" });
    expect(result.success).toBe(false);
  });
});

describe("AgentNodeSchema", () => {
  it("accepts a minimal agent node", () => {
    const result = AgentNodeSchema.safeParse({
      id: "a1",
      agent: "claude-code",
      prompt: "Do the thing",
    });
    expect(result.success).toBe(true);
  });

  it("coerces maxRetries from string to number", () => {
    const result = AgentNodeSchema.safeParse({
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      maxRetries: "3",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxRetries).toBe(3);
    }
  });

  it("accepts defaultRefinements", () => {
    const result = AgentNodeSchema.safeParse({
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      defaultRefinements: "none",
    });
    expect(result.success).toBe(true);
  });

  it("accepts defaultChatNotesPath", () => {
    const result = AgentNodeSchema.safeParse({
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      defaultChatNotesPath: "/tmp/notes.md",
    });
    expect(result.success).toBe(true);
  });

  it("accepts defaultTestResult", () => {
    const result = AgentNodeSchema.safeParse({
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      defaultTestResult: "{}",
    });
    expect(result.success).toBe(true);
  });

  it("accepts defaultTestSummary", () => {
    const result = AgentNodeSchema.safeParse({
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      defaultTestSummary: "ok",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown attributes (typo'd default_*)", () => {
    const result = AgentNodeSchema.safeParse({
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      defaultRefinments: "oops",
    });
    expect(result.success).toBe(false);
  });
});
