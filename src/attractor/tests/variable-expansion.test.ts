import { describe, it, expect } from "vitest";
import { variableExpansionTransform, scanUndeclaredCallerVars } from "../transforms/variable-expansion.js";
import type { Graph, Node } from "../types.js";

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

function makeGraphMulti(nodes: Node[], inputs?: string[]): Graph {
  const map = new Map<string, Node>();
  for (const n of nodes) map.set(n.id, n);
  return {
    name: "g",
    nodes: map,
    edges: [],
    inputs,
  } as unknown as Graph;
}

describe("scanUndeclaredCallerVars", () => {
  it("returns no missing when every $var is in initialContext", () => {
    const g = makeGraphMulti(
      [{ id: "a", prompt: "use $foo and $bar" } as unknown as Node],
      ["foo", "bar"],
    );
    const r = scanUndeclaredCallerVars(g, { foo: "1", bar: "2" });
    expect(r.missing).toEqual([]);
    expect(r.declared).toEqual([]);
    expect(r.undeclared).toEqual([]);
  });

  it("reports missing vars not in context", () => {
    const g = makeGraphMulti([{ id: "a", prompt: "use $foo" } as unknown as Node]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing).toEqual(["foo"]);
  });

  it("ignores $goal and $project (reserved)", () => {
    const g = makeGraphMulti([{ id: "a", prompt: "$goal in $project for $bar" } as unknown as Node]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing).toEqual(["bar"]);
  });

  it("ignores variables produced by an upstream node (produces attribute)", () => {
    const g = makeGraphMulti([
      { id: "p", jsonSchemaFile: "schema.json", produces: "agent_success" } as unknown as Node,
      { id: "c", prompt: "uses $agent_success and $foo" } as unknown as Node,
    ]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing).toEqual(["foo"]);
  });

  it("partitions missing into declared (in inputs=) vs undeclared (not in inputs=)", () => {
    const g = makeGraphMulti(
      [{ id: "a", prompt: "$foo and $bar" } as unknown as Node],
      ["foo"],
    );
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing.sort()).toEqual(["bar", "foo"]);
    expect(r.declared).toEqual(["foo"]);
    expect(r.undeclared).toEqual(["bar"]);
  });

  it("walks prompt and toolCommand attributes for $var references", () => {
    const g = makeGraphMulti([
      { id: "a", prompt: "$one" } as unknown as Node,
      { id: "b", toolCommand: "echo $two" } as unknown as Node,
    ]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing.sort()).toEqual(["one", "two"]);
  });
});
