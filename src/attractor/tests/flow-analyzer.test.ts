import { describe, it, expect } from "vitest";
import { computeVarsInScope } from "../core/flow-analyzer.js";
import type { Graph } from "../types.js";
import { toCamel } from "../core/dot-common.js";

function mkGraph(
  nodes: { id: string; produces?: string[]; defaults?: string[] }[],
  edges: [string, string][],
  callerInputs: string[] = [],
): { graph: Graph; nodeProduces: Map<string, Set<string>> } {
  const nodeMap = new Map();
  const nodeProduces = new Map<string, Set<string>>();
  for (const n of nodes) {
    const nodeObj: any = { id: n.id, sourceLocation: { line: 1, file: "test.dot" } };
    for (const d of n.defaults ?? []) {
      // DOT `default_<var>` is normalized to camelCase at parse time via toCamel.
      // e.g. default_foo → defaultFoo, default_test_result → defaultTestResult
      nodeObj[toCamel(`default_${d}`)] = "x";
    }
    nodeMap.set(n.id, nodeObj);
    nodeProduces.set(n.id, new Set(n.produces ?? []));
  }
  const graph: Graph = {
    name: "test",
    nodes: nodeMap,
    edges: edges.map(([from, to]) => ({ from, to, sourceLocation: { line: 1, file: "test.dot" } })),
    inputs: callerInputs,
  } as any;
  return { graph, nodeProduces };
}

describe("computeVarsInScope", () => {
  it("linear chain: each node sees union of upstream produces", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a", produces: ["foo"] },
        { id: "b", produces: ["bar"] },
        { id: "c" },
        { id: "exit" },
      ],
      [["start", "a"], ["a", "b"], ["b", "c"], ["c", "exit"]],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("a")).toEqual(new Set());
    expect(scope.get("b")).toEqual(new Set(["foo"]));
    expect(scope.get("c")).toEqual(new Set(["foo", "bar"]));
  });

  it("converging branches: intersection — only vars produced on EVERY path are in scope", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a", produces: ["foo", "bar"] },
        { id: "b", produces: ["foo"] },
        { id: "c" },
        { id: "exit" },
      ],
      [["start", "a"], ["start", "b"], ["a", "c"], ["b", "c"], ["c", "exit"]],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("c")).toEqual(new Set(["foo"]));
  });

  it("default_<key>= adds the key unconditionally, even when not all branches produce", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a", produces: ["foo"] },
        { id: "b" },
        { id: "c", defaults: ["foo"] },
        { id: "exit" },
      ],
      [["start", "a"], ["start", "b"], ["a", "c"], ["b", "c"], ["c", "exit"]],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("c")).toContain("foo");
  });

  it("caller inputs are in scope from start onwards", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a" },
        { id: "exit" },
      ],
      [["start", "a"], ["a", "exit"]],
      ["project", "run_id"],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("a")).toEqual(new Set(["project", "run_id"]));
  });

  it("default_<multi_word_key>= recovers snake_case var name (camelCase parse-time normalization is inverted)", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a", defaults: ["test_result"] },
        { id: "exit" },
      ],
      [["start", "a"], ["a", "exit"]],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("a")).toContain("test_result");
  });

  it("cycle (retry loop): back-edge does not contribute to forward scope", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a", produces: ["foo"] },
        { id: "b", produces: ["bar"] },
        { id: "exit" },
      ],
      [["start", "a"], ["a", "b"], ["b", "a"], ["b", "exit"]],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("a")).toEqual(new Set());
    expect(scope.get("b")).toEqual(new Set(["foo"]));
  });
});
