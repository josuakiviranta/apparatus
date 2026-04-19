import { describe, it, expect } from "vitest";
import { BaseNodeSchema, AgentNodeSchema, ToolNodeSchema } from "../core/schemas.js";

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

describe("ToolNodeSchema", () => {
  it("requires cwd", () => {
    const result = ToolNodeSchema.safeParse({
      id: "t1",
      type: "tool",
      toolCommand: "echo hi",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty-string cwd", () => {
    const result = ToolNodeSchema.safeParse({
      id: "t1",
      type: "tool",
      cwd: "",
      toolCommand: "echo hi",
    });
    expect(result.success).toBe(false);
  });

  it("accepts toolCommand only", () => {
    const result = ToolNodeSchema.safeParse({
      id: "t1",
      type: "tool",
      cwd: ".",
      toolCommand: "echo hi",
    });
    expect(result.success).toBe(true);
  });

  it("accepts scriptFile only", () => {
    const result = ToolNodeSchema.safeParse({
      id: "t1",
      type: "tool",
      cwd: ".",
      scriptFile: "scripts/foo.sh",
    });
    expect(result.success).toBe(true);
  });

  it("rejects both toolCommand and scriptFile (script_command_conflict)", () => {
    const result = ToolNodeSchema.safeParse({
      id: "t1",
      type: "tool",
      cwd: ".",
      toolCommand: "echo hi",
      scriptFile: "scripts/foo.sh",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes("script_command_conflict"))).toBe(true);
    }
  });

  it("rejects neither toolCommand nor scriptFile", () => {
    const result = ToolNodeSchema.safeParse({
      id: "t1",
      type: "tool",
      cwd: ".",
    });
    expect(result.success).toBe(false);
  });
});
