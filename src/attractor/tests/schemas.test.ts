import { describe, it, expect } from "vitest";
import {
  BaseNodeSchema,
  AgentNodeSchema,
  ToolNodeSchema,
  GateNodeSchema,
  StartNodeSchema,
  ExitNodeSchema,
  classifyNode,
  validateNode,
} from "../core/schemas.js";
import type { Node } from "../types.js";

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

describe("GateNodeSchema", () => {
  it("requires a non-empty label", () => {
    const result = GateNodeSchema.safeParse({
      id: "g1",
      shape: "hexagon",
      label: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts hexagon + non-empty label", () => {
    const result = GateNodeSchema.safeParse({
      id: "g1",
      shape: "hexagon",
      label: "Should we proceed?",
    });
    expect(result.success).toBe(true);
  });
});

describe("StartNodeSchema", () => {
  it("accepts shape Mdiamond", () => {
    const result = StartNodeSchema.safeParse({
      id: "start",
      shape: "Mdiamond",
    });
    expect(result.success).toBe(true);
  });
});

describe("ExitNodeSchema", () => {
  it("accepts shape Msquare", () => {
    const result = ExitNodeSchema.safeParse({
      id: "exit",
      shape: "Msquare",
    });
    expect(result.success).toBe(true);
  });
});

describe("classifyNode", () => {
  it("classifies tool nodes by type='tool'", () => {
    const node: Node = { id: "t1", type: "tool", cwd: ".", toolCommand: "x" };
    expect(classifyNode(node)).toBe("tool");
  });

  it("classifies start nodes by shape='Mdiamond'", () => {
    const node: Node = { id: "start", shape: "Mdiamond" };
    expect(classifyNode(node)).toBe("start");
  });

  it("classifies exit nodes by shape='Msquare'", () => {
    const node: Node = { id: "exit", shape: "Msquare" };
    expect(classifyNode(node)).toBe("exit");
  });

  it("classifies gate nodes by shape='hexagon'", () => {
    const node: Node = { id: "g1", shape: "hexagon", label: "Q?" };
    expect(classifyNode(node)).toBe("gate");
  });

  it("classifies agent nodes by presence of agent attr", () => {
    const node: Node = { id: "a1", agent: "claude-code", prompt: "p" };
    expect(classifyNode(node)).toBe("agent");
  });
});

describe("validateNode", () => {
  it("returns [] for a valid agent node", () => {
    const node: Node = { id: "a1", agent: "claude-code", prompt: "p" };
    expect(validateNode(node)).toEqual([]);
  });

  it("emits schema_error with node id for unknown attribute", () => {
    const node: Node = {
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      tool_commnd: "oops",
    };
    const diags = validateNode(node);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].rule).toBe("schema_error");
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("[a1]");
  });

  it("emits schema_error for tool node missing cwd", () => {
    const node: Node = { id: "t1", type: "tool", toolCommand: "echo" };
    const diags = validateNode(node);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].rule).toBe("schema_error");
    expect(diags[0].message).toContain("[t1]");
  });

  it("returns [] for a valid tool node", () => {
    const node: Node = { id: "t1", type: "tool", cwd: ".", toolCommand: "echo" };
    expect(validateNode(node)).toEqual([]);
  });

  it("returns [] for a valid gate node", () => {
    const node: Node = { id: "g1", shape: "hexagon", label: "Proceed?" };
    expect(validateNode(node)).toEqual([]);
  });
});
