import { describe, it, expect } from "vitest";
import { extractAgentMetadata } from "../lib/agent-loader.js";
import type { AgentConfig } from "../lib/agent.js";

const cfg = (over: Partial<AgentConfig>): AgentConfig => ({
  name: "demo",
  description: "x",
  model: "opus",
  permissionMode: "dangerouslySkipPermissions",
  tools: [],
  mcp: [],
  prompt: "",
  ...over,
});

describe("extractAgentMetadata", () => {
  it("projects outputs Record keys to a string array", () => {
    const m = extractAgentMetadata(
      cfg({ outputs: { foo: "string" as any, bar: "number" as any } }),
    );
    expect(m.outputs).toEqual(["foo", "bar"]);
  });

  it("returns [] for outputs when undefined", () => {
    expect(extractAgentMetadata(cfg({})).outputs).toEqual([]);
  });

  it("returns [] for outputs when empty Record", () => {
    expect(extractAgentMetadata(cfg({ outputs: {} })).outputs).toEqual([]);
  });

  it("passes inputs through when array", () => {
    expect(extractAgentMetadata(cfg({ inputs: ["a", "b"] })).inputs).toEqual([
      "a",
      "b",
    ]);
  });

  it("returns [] for inputs when undefined", () => {
    expect(extractAgentMetadata(cfg({})).inputs).toEqual([]);
  });

  it("does not include outputs values, only keys", () => {
    const m = extractAgentMetadata(cfg({ outputs: { x: "string" as any } }));
    expect(m.outputs).toEqual(["x"]);
    expect((m.outputs as unknown[])[0]).not.toEqual({ type: "string" });
  });
});
