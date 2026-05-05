import { describe, it, expect } from "vitest";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

describe("validateGraph portability_heuristic", () => {
  it("warns when prompt hardcodes meditations/ path", () => {
    const src = `digraph t {
      start [shape=Mdiamond]
      done [shape=Msquare]
      a [agent="implement", prompt="Read meditations/illuminations/*.md and summarize"]
      start -> a -> done
    }`;
    const graph = parseDot(src);
    const diags = validateGraph(graph);
    const warns = diags.filter(d => d.rule === "portability_heuristic");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0].message).toContain("meditations/");
  });

  it("warns when prompt hardcodes docs/superpowers/ path", () => {
    const src = `digraph t {
      start [shape=Mdiamond]
      done [shape=Msquare]
      a [agent="implement", prompt="Write to docs/superpowers/specs/design.md"]
      start -> a -> done
    }`;
    const graph = parseDot(src);
    const diags = validateGraph(graph);
    const warns = diags.filter(d => d.rule === "portability_heuristic");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("does not warn when values are variables", () => {
    const src = `digraph t {
      inputs="illumination_path"
      start [shape=Mdiamond]
      done [shape=Msquare]
      a [agent="$implement_agent", prompt="Read $illumination_path and summarize"]
      start -> a -> done
    }`;
    const graph = parseDot(src);
    const diags = validateGraph(graph);
    const warns = diags.filter(d => d.rule === "portability_heuristic");
    expect(warns.length).toBe(0);
  });
});
