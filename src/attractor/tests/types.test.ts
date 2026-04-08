import { describe, it, expect } from "vitest";
import type { Graph, Node, Edge, Outcome } from "../types.js";

describe("types", () => {
  it("Graph accepts nodes and edges", () => {
    const g: Graph = {
      name: "test",
      nodes: new Map([["start", { id: "start", shape: "Mdiamond" }]]),
      edges: [],
    };
    expect(g.nodes.size).toBe(1);
  });

  it("Outcome has required status", () => {
    const o: Outcome = { status: "success" };
    expect(o.status).toBe("success");
  });
});
