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

describe("parseDotV2 — malformed input", () => {
  it("throws when input has no digraph/graph root", () => {
    // Silent empty graphs surface downstream as misleading "0 nodes" errors.
    // Require explicit failure so callers see the real reason.
    expect(() => parseDotV2("// nothing here\n")).toThrow();
  });

  it("throws on empty input", () => {
    expect(() => parseDotV2("")).toThrow();
  });
});

describe("parseDotV2 — multiline quoted values", () => {
  it("preserves escaped quotes across a multiline string", () => {
    const src = `digraph m {
  a [label="say \\"hi\\"
across lines"]
}`;
    const g = parseDotV2(src);
    // \n collapses to space; \" unescapes to "
    expect(g.nodes.get("a")?.label).toBe('say "hi" across lines');
  });
});

describe("parseDotV2 — subgraph default scoping", () => {
  it("applies outer defaults to outer nodes, inner defaults to inner nodes", () => {
    const src = `digraph s {
  node [shape=box]
  outer1 []
  subgraph cluster_a {
    node [shape=ellipse]
    inner1 []
  }
  outer2 []
}`;
    const g = parseDotV2(src);
    expect(g.nodes.get("outer1")?.shape).toBe("box");
    expect(g.nodes.get("inner1")?.shape).toBe("ellipse");
    // REGRESSION guard: outer2 must NOT inherit subgraph's ellipse default.
    // Current AST walker shares defaults across subgraph boundaries — this
    // asserts the DOT-correct scoping the future fix must maintain.
    expect(g.nodes.get("outer2")?.shape).toBe("box");
  });
});
