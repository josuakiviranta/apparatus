import { describe, it, expect } from "vitest";
import { parseDotV2 } from "../core/graph-ast.js";
import { DotSyntaxError } from "../core/dot-syntax.js";

describe("parseDotV2 syntax errors", () => {
  it("wraps PEG syntax errors with location", () => {
    const bad = `digraph g {\n  start [shape="Mdiamond"\n  done\n}`;
    let err: unknown;
    try { parseDotV2(bad); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DotSyntaxError);
    const dse = err as DotSyntaxError;
    expect(dse.location.line).toBeGreaterThanOrEqual(2);
    expect(dse.location.column).toBeGreaterThan(0);
  });
});
