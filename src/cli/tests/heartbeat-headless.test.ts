import { describe, it, expect } from "vitest";
import { parseDot } from "../../attractor/core/graph.js";

const UNSAFE_DOT = `digraph g {
  goal="test"
  headless_safe=false
  start [shape=Mdiamond]
  done [shape=Msquare]
  start -> done
}`;

const SAFE_DOT = `digraph g {
  goal="test"
  start [shape=Mdiamond]
  done [shape=Msquare]
  start -> done
}`;

describe("heartbeat pipeline headless_safe warning", () => {
  it("parseDot returns headlessSafe=false for unsafe pipeline", () => {
    const graph = parseDot(UNSAFE_DOT);
    expect(graph.headlessSafe).toBe(false);
  });

  it("parseDot returns headlessSafe=undefined for safe pipeline", () => {
    const graph = parseDot(SAFE_DOT);
    expect(graph.headlessSafe).toBeUndefined();
  });
});
