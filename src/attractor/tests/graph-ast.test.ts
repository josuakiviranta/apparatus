import { describe, it, expect } from "vitest";
import { parseDotV2 } from "../core/graph-ast.js";

describe("parseDotV2 — minimal", () => {
  it("parses a single-node graph", () => {
    const g = parseDotV2(`digraph foo { start [shape=Mdiamond] }`);
    expect(g.name).toBe("foo");
    expect(g.nodes.size).toBe(1);
    expect(g.nodes.get("start")?.shape).toBe("Mdiamond");
  });

  it("records sourceLine on each node", () => {
    const g = parseDotV2(`digraph foo {
  start [shape=Mdiamond]
  done [shape=Msquare]
}`);
    expect(g.nodes.get("start")?.sourceLine).toBe(2);
    expect(g.nodes.get("done")?.sourceLine).toBe(3);
  });
});
