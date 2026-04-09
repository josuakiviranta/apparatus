import { describe, it, expect } from "vitest";
import { variableExpansionTransform } from "../transforms/variable-expansion.js";
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
