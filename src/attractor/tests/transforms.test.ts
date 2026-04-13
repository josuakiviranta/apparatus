import { describe, it, expect } from "vitest";
import { variableExpansionTransform, expandVariables, extractDefaults, UndefinedVariableError } from "../transforms/variable-expansion.js";
import { buildPreamble } from "../transforms/preamble.js";
import type { Graph, CheckpointState } from "../types.js";

function makeGraph(overrides: Partial<Graph> = {}): Graph {
  return {
    name: "test",
    goal: "Ship it",
    nodes: new Map([
      ["start", { id: "start", shape: "Mdiamond" }],
      ["work",  { id: "work", shape: "box", prompt: "Do $goal in $project" }],
      ["done",  { id: "done", shape: "Msquare" }],
    ]),
    edges: [
      { from: "start", to: "work" },
      { from: "work", to: "done" },
    ],
    ...overrides,
  };
}

describe("variableExpansionTransform", () => {
  it("replaces $goal in node prompts", () => {
    const g = variableExpansionTransform(makeGraph(), { project: "/my/project" });
    expect(g.nodes.get("work")?.prompt).toBe("Do Ship it in /my/project");
  });

  it("replaces $goal in tool_command", () => {
    const g = makeGraph();
    g.nodes.get("work")!.toolCommand = "run $goal";
    const result = variableExpansionTransform(g, { project: "/proj" });
    expect(result.nodes.get("work")?.toolCommand).toBe("run Ship it");
  });

  it("does not mutate original graph", () => {
    const g = makeGraph();
    const original = g.nodes.get("work")?.prompt;
    variableExpansionTransform(g, { project: "/proj" });
    expect(g.nodes.get("work")?.prompt).toBe(original);
  });

  it("expands arbitrary context keys in prompts", () => {
    const g = makeGraph();
    g.nodes.get("work")!.prompt = "Iteration $loop.iteration, prior success: $agent.success";
    const result = variableExpansionTransform(g, {
      project: "/proj",
      context: { "loop.iteration": "2", "agent.success": "true" },
    });
    expect(result.nodes.get("work")?.prompt).toBe("Iteration 2, prior success: true");
  });

  it("leaves unknown context variables as-is", () => {
    const g = makeGraph();
    g.nodes.get("work")!.prompt = "Value: $unknown.key";
    const result = variableExpansionTransform(g, { project: "/proj", context: {} });
    expect(result.nodes.get("work")?.prompt).toBe("Value: $unknown.key");
  });
});

describe("expandVariables", () => {
  it("expands $key references from context", () => {
    const result = expandVariables(
      "File at $illumination_path has $summary",
      { illumination_path: "/meditations/foo.md", summary: "a bug" },
    );
    expect(result).toBe("File at /meditations/foo.md has a bug");
  });

  it("leaves $goal and $project unexpanded (handled by graph transform)", () => {
    const result = expandVariables("Goal: $goal, Path: $illumination_path", {
      illumination_path: "/foo.md",
    });
    expect(result).toBe("Goal: $goal, Path: /foo.md");
  });

  it("throws UndefinedVariableError for undefined context variables", () => {
    expect(() => expandVariables("Value: $unknown", {})).toThrow(UndefinedVariableError);
  });

  it("substitutes default value when variable is undefined but default is provided", () => {
    const result = expandVariables("Refinements: $refinements", {}, { refinements: "No refinements provided." });
    expect(result).toBe("Refinements: No refinements provided.");
  });

  it("expands defined variables without requiring defaults", () => {
    const result = expandVariables("Hello $name", { name: "world" }, { name: "fallback" });
    expect(result).toBe("Hello world");
  });

  it("returns input unchanged when context is empty", () => {
    const result = expandVariables("No vars here", {});
    expect(result).toBe("No vars here");
  });
});

describe("buildPreamble", () => {
  const checkpoint: CheckpointState = {
    timestamp: "2026-04-08T12:00:00Z",
    currentNode: "work",
    completedNodes: ["start", "meditate"],
    nodeRetries: {},
    context: { "meditate.sessionId": "abc", "meditate.illuminations": "3" },
  };

  it("returns non-empty string for compact fidelity", () => {
    const preamble = buildPreamble(checkpoint, "compact");
    expect(preamble).toContain("meditate");
    expect(preamble.length).toBeGreaterThan(0);
  });

  it("returns empty string for full fidelity", () => {
    const preamble = buildPreamble(checkpoint, "full");
    expect(preamble).toBe("");
  });
});

describe("buildPreamble coerces non-string context values", () => {
  const base = (ctx: Record<string, unknown>): CheckpointState => ({
    timestamp: "",
    currentNode: "n1",
    completedNodes: ["a"],
    nodeRetries: {},
    context: ctx,
  });

  it("coerces numbers via String()", () => {
    const out = buildPreamble(base({ "k.n": 42 }), "compact");
    expect(out).toContain("k.n: 42");
  });

  it("coerces booleans via String()", () => {
    const out = buildPreamble(base({ "k.b": true }), "compact");
    expect(out).toContain("k.b: true");
  });

  it("stringifies objects via JSON.stringify", () => {
    const out = buildPreamble(base({ "k.o": { a: 1, b: 2 } }), "compact");
    expect(out).toContain('k.o: {"a":1,"b":2}');
  });

  it("handles null/undefined", () => {
    const out = buildPreamble(base({ "k.null": null, "k.undef": undefined }), "compact");
    expect(out).toContain("k.null: null");
    expect(out).toContain("k.undef: undefined");
  });
});

describe("extractDefaults", () => {
  it("extracts default_* camelCase properties from node-like object", () => {
    const node = { id: "test", defaultRefinements: "No refinements", defaultFoo: "bar", prompt: "hello" };
    const defaults = extractDefaults(node);
    expect(defaults).toEqual({ refinements: "No refinements", foo: "bar" });
  });

  it("returns empty object when no defaults exist", () => {
    const node = { id: "test", prompt: "hello" };
    expect(extractDefaults(node)).toEqual({});
  });

  it("ignores properties named exactly 'default'", () => {
    const node = { id: "test", default: "something" };
    expect(extractDefaults(node)).toEqual({});
  });

  it("lowercases the first character after 'default' prefix", () => {
    const node = { defaultMyVar: "value" };
    const defaults = extractDefaults(node);
    expect(defaults).toEqual({ myVar: "value" });
  });

  it("coerces non-string values to strings", () => {
    const node = { defaultCount: 42, defaultEnabled: true };
    const defaults = extractDefaults(node);
    expect(defaults).toEqual({ count: "42", enabled: "true" });
  });
});

describe("expandVariables coerces non-string context values", () => {
  it("expands a numeric context value", () => {
    const out = expandVariables("turns=$chat.turnsUsed", { "chat.turnsUsed": 7 });
    expect(out).toBe("turns=7");
  });

  it("expands a boolean context value", () => {
    const out = expandVariables("ok=$chat.success", { "chat.success": true });
    expect(out).toBe("ok=true");
  });

  it("stringifies an object context value", () => {
    const out = expandVariables("d=$chat.digest", { "chat.digest": { n: 1 } });
    expect(out).toBe('d={"n":1}');
  });

  it("passes through string values unchanged", () => {
    const out = expandVariables("s=$k", { k: "hello" });
    expect(out).toBe("s=hello");
  });
});
