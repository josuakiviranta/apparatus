import { describe, it, expect } from "vitest";
import { parseDot } from "../core/graph.js";

describe("parseDot", () => {
  it("parses a minimal digraph with start and exit nodes", () => {
    const dot = `digraph test {
      goal="Do something"
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.name).toBe("test");
    expect(graph.goal).toBe("Do something");
    expect(graph.nodes.has("start")).toBe(true);
    expect(graph.nodes.get("start")?.shape).toBe("Mdiamond");
    expect(graph.nodes.has("done")).toBe(true);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: "start", to: "done" });
  });

  it("strips // line comments", () => {
    const dot = `digraph g {
      // this is a comment
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.size).toBe(2);
  });

  it("strips /* */ block comments", () => {
    const dot = `digraph g {
      /* block comment */
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.size).toBe(2);
  });

  it("parses node with multiple attributes", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      implement [shape=box, prompt="Do the work", max_retries=3]
      start -> implement -> done
    }`;
    const graph = parseDot(dot);
    const n = graph.nodes.get("implement")!;
    expect(n.shape).toBe("box");
    expect(n.prompt).toBe("Do the work");
    expect(n.maxRetries).toBe(3);
  });

  it("parses chained edges A -> B -> C as two edges", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      mid [shape=box]
      done [shape=Msquare]
      start -> mid -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: "start", to: "mid" });
    expect(graph.edges[1]).toMatchObject({ from: "mid", to: "done" });
  });

  it("parses edge with label and condition", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done [label="OK", condition="outcome=success", weight=2]
    }`;
    const graph = parseDot(dot);
    expect(graph.edges[0]).toMatchObject({
      label: "OK",
      condition: "outcome=success",
      weight: 2,
    });
  });

  it("applies node default blocks to subsequent declarations", () => {
    const dot = `digraph g {
      node [shape=box]
      start [shape=Mdiamond]
      work []
      done [shape=Msquare]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.get("work")?.shape).toBe("box");
    expect(graph.nodes.get("start")?.shape).toBe("Mdiamond");
  });

  it("parses graph-level attributes", () => {
    const dot = `digraph pipeline {
      goal="Ship it"
      label="My Pipeline"
      default_max_retries=2
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.goal).toBe("Ship it");
    expect(graph.label).toBe("My Pipeline");
    expect(graph.defaultMaxRetries).toBe(2);
  });

  it("flattens subgraph blocks", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      subgraph cluster_1 {
        work [shape=box]
      }
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.has("work")).toBe(true);
    expect(graph.edges).toHaveLength(2);
  });

  it("parses multi-line attribute blocks", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      work [
        shape=box,
        prompt="Do the thing"
      ]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.get("work")?.prompt).toBe("Do the thing");
  });

  it("converts snake_case attribute names to camelCase on nodes", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare, goal_gate=true]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.get("done")?.goalGate).toBe(true);
  });

  it("merges class attributes from model_stylesheet", () => {
    const dot = `digraph g {
      model_stylesheet="
        .fast { llm_model: claude-haiku-4-5-20251001 }
      "
      start [shape=Mdiamond]
      done [shape=Msquare]
      work [class=fast, shape=box]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.get("work")?.class).toBe("fast");
  });
});
