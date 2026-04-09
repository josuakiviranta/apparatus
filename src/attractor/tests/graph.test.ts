import { describe, it, expect } from "vitest";
import { parseDot, validateGraph, resolveHandlerType } from "../core/graph.js";

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

  it("applies shape selector from model_stylesheet", () => {
    const dot = `digraph g {
      model_stylesheet="
        box { llm_model: claude-haiku-4-5-20251001 }
      "
      start [shape=Mdiamond]
      done [shape=Msquare]
      work [shape=box]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.get("work")?.llmModel).toBe("claude-haiku-4-5-20251001");
    // Shape selector should not affect nodes of different shapes
    expect(graph.nodes.get("start")?.llmModel).toBeUndefined();
  });

  it("applies id selector from model_stylesheet", () => {
    const dot = `digraph g {
      model_stylesheet="
        #priority { llm_model: claude-opus-4-6 }
      "
      start [shape=Mdiamond]
      done [shape=Msquare]
      priority [shape=box]
      start -> priority -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.get("priority")?.llmModel).toBe("claude-opus-4-6");
  });

  it("applies universal selector from model_stylesheet", () => {
    const dot = `digraph g {
      model_stylesheet="
        * { llm_model: claude-sonnet-4-6 }
      "
      start [shape=Mdiamond]
      done [shape=Msquare]
      work [shape=box]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    // Universal applies to all nodes
    expect(graph.nodes.get("work")?.llmModel).toBe("claude-sonnet-4-6");
    expect(graph.nodes.get("start")?.llmModel).toBe("claude-sonnet-4-6");
  });

  it("respects specificity: id > class > shape > universal", () => {
    const dot = `digraph g {
      model_stylesheet="
        * { llm_model: universal-model }
        box { llm_model: shape-model }
        .premium { llm_model: class-model }
        #special { llm_model: id-model }
      "
      start [shape=Mdiamond]
      done [shape=Msquare]
      special [shape=box, class=premium]
      regular [shape=box, class=premium]
      basic [shape=box]
      start -> special -> regular -> basic -> done
    }`;
    const graph = parseDot(dot);
    // #special matches by id — highest specificity wins
    expect(graph.nodes.get("special")?.llmModel).toBe("id-model");
    // .premium matches by class — higher than shape
    expect(graph.nodes.get("regular")?.llmModel).toBe("class-model");
    // box matches by shape — higher than universal
    expect(graph.nodes.get("basic")?.llmModel).toBe("shape-model");
    // start has no matching shape/class/id rule, universal applies
    expect(graph.nodes.get("start")?.llmModel).toBe("universal-model");
  });
});

describe("resolveHandlerType with agent attribute", () => {
  it("resolves agent attribute to 'agent' handler type", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      review [agent="reviewer"]
      done [shape=Msquare]
      start -> review -> done
    }`;
    const graph = parseDot(dot);
    const reviewNode = graph.nodes.get("review")!;
    expect(reviewNode.agent).toBe("reviewer");
    expect(resolveHandlerType(reviewNode)).toBe("agent");
  });

  it("agent attribute takes precedence over shape", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work [shape=box, agent="implement"]
      done [shape=Msquare]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    const workNode = graph.nodes.get("work")!;
    expect(resolveHandlerType(workNode)).toBe("agent");
  });

  it("agent attribute takes precedence over explicit type", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work [type=codergen, agent="implement"]
      done [shape=Msquare]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    const workNode = graph.nodes.get("work")!;
    expect(resolveHandlerType(workNode)).toBe("agent");
  });

  it("'agent' is in KNOWN_TYPES (no type_known warning)", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work [agent="reviewer"]
      done [shape=Msquare]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph);
    expect(diags.some(d => d.rule === "type_known" && d.message.includes("work"))).toBe(false);
  });
});

describe("validateGraph", () => {
  function makeValid() {
    return parseDot(`digraph g {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`);
  }

  it("returns no errors for a valid graph", () => {
    const diags = validateGraph(makeValid());
    expect(diags.filter(d => d.severity === "error")).toHaveLength(0);
  });

  it("errors when no start node", () => {
    const g = makeValid();
    g.nodes.delete("start");
    g.edges = [];
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "start_node")).toBe(true);
  });

  it("errors when no exit node", () => {
    const g = makeValid();
    g.nodes.delete("done");
    g.edges = [];
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "terminal_node")).toBe(true);
  });

  it("errors on orphan node (unreachable from start)", () => {
    const g = makeValid();
    g.nodes.set("orphan", { id: "orphan", shape: "box" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "reachability")).toBe(true);
  });

  it("errors on edge targeting unknown node", () => {
    const g = makeValid();
    g.edges.push({ from: "start", to: "ghost" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "edge_target_exists")).toBe(true);
  });

  it("errors when start node has incoming edges", () => {
    const g = makeValid();
    g.edges.push({ from: "done", to: "start" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "start_no_incoming")).toBe(true);
  });

  it("errors when exit node has outgoing edges", () => {
    const g = makeValid();
    g.edges.push({ from: "done", to: "start" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "exit_no_outgoing")).toBe(true);
  });

  it("warns on unknown node type", () => {
    const g = makeValid();
    g.nodes.get("start")!.type = "unknown.handler";
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "type_known" && d.severity === "warning")).toBe(true);
  });

  it("errors on bad condition expression syntax", () => {
    const g = makeValid();
    g.edges[0].condition = "outcome == success";
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "condition_syntax")).toBe(true);
  });

  it("errors on parallel node type (not yet implemented)", () => {
    const g = makeValid();
    g.nodes.set("par", { id: "par", shape: "component" });
    g.edges.push({ from: "start", to: "par" });
    g.edges.push({ from: "par", to: "done" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "type_unsupported" && d.severity === "error")).toBe(true);
    expect(diags.some(d => d.message.includes("parallel"))).toBe(true);
  });
});
