import { describe, it, expect } from "vitest";
import { variableExpansionTransform } from "../transforms/variable-expansion.js";
import type { Graph } from "../types.js";

function makeGraph(nodeAttrs: Record<string, unknown>): Graph {
  return {
    name: "test",
    nodes: new Map([["run", { id: "run", label: "run", shape: "box", ...nodeAttrs }]]),
    edges: [],
  } as unknown as Graph;
}

describe("variableExpansionTransform — maxIterations", () => {
  it("expands $max_iterations in maxIterations node attribute", () => {
    const graph = makeGraph({ maxIterations: "$max_iterations" });
    const result = variableExpansionTransform(graph, {
      context: { max_iterations: "5" },
    });
    const node = result.nodes.get("run")!;
    expect(node.maxIterations).toBe("5");
  });

  it("leaves numeric maxIterations unchanged", () => {
    const graph = makeGraph({ maxIterations: 3 });
    const result = variableExpansionTransform(graph, { context: {} });
    expect(result.nodes.get("run")!.maxIterations).toBe(3);
  });
});
