import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseDot, validateGraph, resolveHandlerType } from "../core/graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  it("parses headless_safe=false as headlessSafe boolean", () => {
    const dot = `digraph g {
      goal="test"
      headless_safe=false
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.headlessSafe).toBe(false);
  });

  it("parses headless_safe=true as headlessSafe boolean", () => {
    const dot = `digraph g {
      headless_safe=true
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.headlessSafe).toBe(true);
  });

  it("defaults headlessSafe to undefined when attribute is absent", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.headlessSafe).toBeUndefined();
  });
});

describe("parseDot — Bug B.2 unescape inside quoted attributes", () => {
  it("unescapes \\n inside quoted node attr", () => {
    const src = `digraph t {
      start [shape=Mdiamond]
      done [shape=Msquare]
      n1 [kind=agent, prompt="line1\\nline2"]
      start -> n1 -> done
    }`;
    const g = parseDot(src);
    const n = g.nodes.get("n1")!;
    expect(n.prompt).toBe("line1\nline2");
  });

  it("unescapes \\t and \\\" inside quoted attr", () => {
    const src = `digraph t {
      start [shape=Mdiamond]
      done [shape=Msquare]
      n1 [kind=agent, prompt="tab\\there and \\"quote\\""]
      start -> n1 -> done
    }`;
    const g = parseDot(src);
    expect(g.nodes.get("n1")!.prompt).toBe('tab\there and "quote"');
  });

  it("unescapes \\\\ inside quoted attr", () => {
    const src = `digraph t {
      start [shape=Mdiamond]
      done [shape=Msquare]
      n1 [kind=agent, prompt="a\\\\b"]
      start -> n1 -> done
    }`;
    const g = parseDot(src);
    expect(g.nodes.get("n1")!.prompt).toBe("a\\b");
  });

  it("does NOT touch unquoted values (kind=agent)", () => {
    const src = `digraph t {
      start [shape=Mdiamond]
      done [shape=Msquare]
      n1 [kind=agent, weight=5]
      start -> n1 -> done
    }`;
    const g = parseDot(src);
    const n = g.nodes.get("n1")!;
    expect(n.kind).toBe("agent");
    expect(n.weight).toBe(5);
  });

  it("does NOT interpret backslashes in unquoted identifier values", () => {
    const src = `digraph t {
      start [shape=Mdiamond]
      done [shape=Msquare]
      n1 [kind=agent]
      start -> n1 -> done
    }`;
    const g = parseDot(src);
    expect(g.nodes.get("n1")!.kind).toBe("agent");
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

  it("errors on stack.manager_loop node type (not yet implemented)", () => {
    const g = makeValid();
    g.nodes.set("mgr", { id: "mgr", shape: "house" });
    g.edges.push({ from: "start", to: "mgr" });
    g.edges.push({ from: "mgr", to: "done" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "type_unsupported" && d.severity === "error")).toBe(true);
    expect(diags.some(d => d.message.includes("stack.manager_loop"))).toBe(true);
  });

  it("errors on non-exit node with zero outgoing edges (dead end)", () => {
    // dangling [label="Decline"] mirrors the mark_archived authoring miss
    // in illumination-to-implementation.dot: reachable from start, but has
    // no outgoing edge, so the engine arrives and has nowhere to go.
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      gate [shape=diamond]
      work [shape=box]
      dangling [shape=box]
      done [shape=Msquare]
      start -> gate
      gate -> work [condition="choice=a"]
      gate -> dangling [condition="choice=b"]
      work -> done
    }`);
    const diags = validateGraph(graph);
    const errs = diags.filter(d => d.rule === "reaches_exit" && d.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("dangling");
  });

  it("does not error when every non-exit node can reach the exit", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      gate [shape=diamond]
      a [shape=box]
      b [shape=box]
      done [shape=Msquare]
      start -> gate
      gate -> a [condition="choice=a"]
      gate -> b [condition="choice=b"]
      a -> done
      b -> done
    }`);
    const diags = validateGraph(graph);
    expect(diags.some(d => d.rule === "reaches_exit")).toBe(false);
  });

  it("flags a cycle with no edge out to the exit as unreachable-to-exit", () => {
    // start -> a -> b -> a (loop), no path to done
    // Forward reachability finds a,b,done reachable (well, done is unreachable here).
    // Let's construct so done is reachable via other path so only the cycle fails.
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      gate [shape=diamond]
      a [shape=box]
      b [shape=box]
      straight [shape=box]
      done [shape=Msquare]
      start -> gate
      gate -> straight [condition="choice=s"]
      gate -> a [condition="choice=c"]
      a -> b
      b -> a
      straight -> done
    }`);
    const diags = validateGraph(graph);
    const errs = diags.filter(d => d.rule === "reaches_exit" && d.severity === "error");
    const ids = errs.map(e => e.message);
    expect(ids.some(m => m.includes("\"a\""))).toBe(true);
    expect(ids.some(m => m.includes("\"b\""))).toBe(true);
  });
});

describe("validateGraph — variable_coverage", () => {
  it("warns when variable producer is unreachable on some paths", () => {
    // Graph: start -> router(diamond) -> [pathA: skip -> consumer] | [pathB: producer -> consumer]
    // consumer references $tool.output in prompt, producer is a tool node
    // Path A skips the tool node, so $tool.output may be undefined
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      router [shape=diamond]
      skip [shape=box, prompt="no vars here"]
      producer [shape=parallelogram, tool_command="echo hello"]
      consumer [shape=box, prompt="Result: $tool.output"]
      done [shape=Msquare]
      start -> router
      router -> skip [condition="choice=a"]
      router -> producer [condition="choice=b"]
      skip -> consumer
      producer -> consumer
      consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("tool.output");
    expect(warnings[0].message).toContain("producer");
    expect(warnings[0].severity).toBe("warning");
  });

  it("does not warn when all paths to consumer pass through producer", () => {
    // Linear: start -> producer(tool) -> consumer -> done
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      producer [shape=parallelogram, tool_command="echo hello"]
      consumer [shape=box, prompt="Result: $tool.output"]
      done [shape=Msquare]
      start -> producer -> consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("does not warn when consumer has default for the variable", () => {
    // consumer references $myvar but has default_myvar attribute
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      consumer [shape=box, prompt="Value: $myvar", default_myvar="fallback"]
      done [shape=Msquare]
      start -> consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("does not warn for $goal or $project variables", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      consumer [shape=box, prompt="Goal: $goal, Project: $project"]
      done [shape=Msquare]
      start -> consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("warns for each uncovered variable separately", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      consumer [shape=box, prompt="A: $varA, B: $varB"]
      done [shape=Msquare]
      start -> consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(2);
  });

  it("recognizes explicit produces attribute on nodes", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      producer [shape=box, agent="impl", produces="summary,explanation"]
      consumer [shape=box, prompt="Summary: $summary"]
      done [shape=Msquare]
      start -> producer -> consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("recognizes store handler as producing store.path", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      saver [shape=cylinder]
      consumer [shape=box, prompt="Saved at: $store.path"]
      done [shape=Msquare]
      start -> saver -> consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("recognizes wait.human handler as producing chat.output", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      ask [shape=hexagon]
      consumer [shape=box, prompt="User said: $chat.output"]
      done [shape=Msquare]
      start -> ask -> consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("recognizes interactive node as producing chat.output", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      interact [shape=box, interactive=true]
      consumer [shape=box, prompt="User said: $chat.output"]
      done [shape=Msquare]
      start -> interact -> consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("recognizes default_<snake_case_var> attribute on consumer", () => {
    // Regression: hasDefault used to do naive capitalization, so
    // default_test_result → key defaultTest_result (malformed), never matched
    // the parser's toCamel-normalized defaultTestResult. Snake_case defaults
    // silently didn't silence warnings.
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      router [shape=diamond]
      producer [shape=box, agent="impl", produces="test_result"]
      consumer [shape=box, default_test_result="", prompt="Result: $test_result"]
      done [shape=Msquare]
      start -> router
      router -> consumer
      router -> producer -> consumer
      consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("recognizes default_<singleword> attribute (backward compat)", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      router [shape=diamond]
      producer [shape=box, agent="impl", produces="refinements"]
      consumer [shape=box, default_refinements="", prompt="R: $refinements"]
      done [shape=Msquare]
      start -> router
      router -> consumer
      router -> producer -> consumer
      consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("scans $var refs inside gate-node labels (hexagon)", () => {
    // Regression: approval_gate in illumination-to-implementation.dot referenced
    // $refinements in its label, but chat_summarizer (the producer) is only on
    // the chat-loop path. First entry to approval_gate skips the producer and
    // crashes the wait-human handler at runtime. Validator must catch this.
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      explainer [shape=box, agent="impl"]
      approval_gate [shape=hexagon, label="Refinements: $refinements"]
      chat [shape=box, agent="impl", interactive=true]
      summarizer [shape=box, agent="impl", produces="refinements"]
      writer [shape=box, agent="impl"]
      done [shape=Msquare]
      start -> explainer -> approval_gate
      approval_gate -> writer [label="Approve"]
      approval_gate -> chat   [label="Chat"]
      chat -> summarizer -> approval_gate
      writer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("refinements");
    expect(warnings[0].message).toContain("approval_gate");
  });

  it("honors default_<var> on a gate-node label (suppresses warning)", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      approval_gate [shape=hexagon, default_refinements="", label="Refinements: $refinements"]
      done [shape=Msquare]
      start -> approval_gate -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("treats wait.human gates as implicit producers of choice and <id>.choice", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond];
      g1   [shape=hexagon, label="First pick?"];
      g2   [shape=hexagon, label="Second pick?"];
      use  [shape=box, prompt="saw $g1.choice then $g2.choice aka $choice"];
      done [shape=Msquare];
      start -> g1; g1 -> g2; g2 -> use; use -> done;
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(0);
  });

  it("still warns when a gate sits on only some paths to the consumer", () => {
    const graph = parseDot(`digraph g {
      start  [shape=Mdiamond];
      router [shape=diamond];
      gate   [shape=hexagon, label="Pick?"];
      merge  [shape=box];
      use    [shape=box, prompt="read $gate.choice"];
      done   [shape=Msquare];
      start -> router;
      router -> gate [condition="x=a"];
      router -> merge [condition="x=b"];
      gate -> merge;
      merge -> use;
      use -> done;
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("may be undefined on path(s) that skip");
    expect(warnings[0].message).toContain("gate");
  });

  it("still warns when a consumer references $choice with no gate upstream", () => {
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond];
      use   [shape=box, prompt="read $choice"];
      done  [shape=Msquare];
      start -> use; use -> done;
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("has no known producer");
    expect(warnings[0].message).toContain("$choice");
  });

  it("scans $var refs inside cwd= on tool nodes", () => {
    // Regression: STRING_ATTRS at variable-expansion.ts:137 includes "cwd",
    // so the runtime expander already handles $var inside cwd=. The validator
    // must match that coverage so authors learn about typos at validate time
    // instead of run time.
    const graph = parseDot(`digraph g {
      start [shape=Mdiamond]
      consumer [shape=parallelogram, tool_command="echo hi", cwd="/tmp/$typoname"]
      done [shape=Msquare]
      start -> consumer -> done
    }`);
    const diags = validateGraph(graph);
    const warnings = diags.filter(d => d.rule === "variable_coverage");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("typoname");
    expect(warnings[0].message).toContain("consumer");
    expect(warnings[0].severity).toBe("warning");
  });
});

describe("parseDot inputs= attribute", () => {
  it("parses comma-separated names into graph.inputs", () => {
    const src = `digraph p {
      inputs="illumination_path, model, output_dir"
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const g = parseDot(src);
    expect(g.inputs).toEqual(["illumination_path", "model", "output_dir"]);
  });

  it("trims whitespace and ignores empty entries", () => {
    const src = `digraph p {
      inputs=" a ,, b , "
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const g = parseDot(src);
    expect(g.inputs).toEqual(["a", "b"]);
  });

  it("deduplicates names, preserving first occurrence order", () => {
    const src = `digraph p {
      inputs="a, b, a"
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const g = parseDot(src);
    expect(g.inputs).toEqual(["a", "b"]);
  });

  it("leaves graph.inputs undefined when attribute absent", () => {
    const src = `digraph p {
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const g = parseDot(src);
    expect(g.inputs).toBeUndefined();
  });
});

describe("validateGraph — inline_script_smell", () => {
  function wrap(toolCommand: string): string {
    return `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      t [type="tool", cwd="$project", tool_command="${toolCommand.replace(/"/g, '\\"')}"]
      start -> t -> done
    }`;
  }

  it("warns on node -e inline scripts", () => {
    const g = parseDot(wrap("node -e 'console.log(1)'"));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell" && d.severity === "warning")).toBe(true);
  });

  it("warns on python -c inline scripts", () => {
    const g = parseDot(wrap("python -c 'print(1)'"));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(true);
  });

  it("warns on python3 -c inline scripts", () => {
    const g = parseDot(wrap("python3 -c 'print(1)'"));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(true);
  });

  it("warns on python2 -c inline scripts", () => {
    const g = parseDot(wrap("python2 -c 'print(1)'"));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(true);
  });

  it("warns on bash -c inline scripts", () => {
    const g = parseDot(wrap("bash -c 'echo hi'"));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(true);
  });

  it("warns on heredoc marker", () => {
    const g = parseDot(wrap("cat <<'EOF'"));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(true);
  });

  it("does not warn at boundary of 120 chars", () => {
    // Exactly 120 chars, no trigger substrings
    const cmd = "a".repeat(120);
    expect(cmd.length).toBe(120);
    const g = parseDot(wrap(cmd));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(false);
  });

  it("warns at 121 chars", () => {
    const cmd = "a".repeat(121);
    expect(cmd.length).toBe(121);
    const g = parseDot(wrap(cmd));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(true);
  });

  it("does not warn on short commands", () => {
    const g = parseDot(wrap("cd $project && git push"));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(false);
  });

  it("applies length check against pre-expansion text ($vars stay literal)", () => {
    // Short runtime-expanded value but literal is > 120: must warn.
    const literal = "echo " + "$x".repeat(80); // 5 + 160 = 165 chars of literal
    expect(literal.length).toBeGreaterThan(120);
    const g = parseDot(wrap(literal));
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(true);
  });

  it("only applies to tool-handler nodes, not codergen", () => {
    const g = parseDot(`digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      work [shape=box, prompt="node -e 'foo'"]
      start -> work -> done
    }`);
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "inline_script_smell")).toBe(false);
  });
});

describe("validateGraph — regression fixture: pre-migration tool node missing cwd", () => {
  it("rejects pre-migration tool node missing cwd (regression fixture)", () => {
    const src = readFileSync(
      new URL("./fixtures/pre-migration-tool-node.dot", import.meta.url),
      "utf8",
    );
    const graph = parseDot(src);
    const diags = validateGraph(graph);
    expect(diags.some(d => d.rule === "schema_error" && d.message.includes("cwd"))).toBe(true);
  });
});

describe("validateGraph — script_file rules", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ralph-graph-validate-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("does not throw when dotDir is omitted (script_file_exists skipped)", () => {
    const g = parseDot(`digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      t [type="tool", cwd="$project", script_file="scripts/missing.mjs"]
      start -> t -> done
    }`);
    expect(() => validateGraph(g)).not.toThrow();
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "script_file_exists")).toBe(false);
  });

  it("errors when script_file points to a missing file (dotDir given)", () => {
    const g = parseDot(`digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      t [type="tool", cwd="$project", script_file="scripts/missing.mjs"]
      start -> t -> done
    }`);
    const diags = validateGraph(g, tmp);
    const errs = diags.filter(d => d.rule === "script_file_exists" && d.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("scripts/missing.mjs");
  });

  it("does not error when script_file exists (using repo fixture)", () => {
    // Use the real repo fixture path so the test exercises the fixture as well.
    const fixturesDir = join(__dirname, "fixtures", "pipelines");
    const g = parseDot(`digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      t [type="tool", cwd="$project", script_file="hello.mjs"]
      start -> t -> done
    }`);
    const diags = validateGraph(g, fixturesDir);
    expect(diags.some(d => d.rule === "script_file_exists")).toBe(false);
  });

  it("errors when both script_file and tool_command are set", () => {
    // Write a real fixture so script_file_exists doesn't also fire
    mkdirSync(join(tmp, "scripts"), { recursive: true });
    writeFileSync(join(tmp, "scripts", "x.mjs"), "");
    const g = parseDot(`digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      t [type="tool", cwd="$project", script_file="scripts/x.mjs", tool_command="echo hi"]
      start -> t -> done
    }`);
    const diags = validateGraph(g, tmp);
    const errs = diags.filter(d => d.rule === "script_command_conflict" && d.severity === "error");
    expect(errs).toHaveLength(1);
  });

  it("errors on unsupported script extension (.rb)", () => {
    mkdirSync(join(tmp, "scripts"), { recursive: true });
    writeFileSync(join(tmp, "scripts", "x.rb"), "");
    const g = parseDot(`digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      t [type="tool", cwd="$project", script_file="scripts/x.rb"]
      start -> t -> done
    }`);
    const diags = validateGraph(g, tmp);
    const errs = diags.filter(d => d.rule === "unsupported_script_extension" && d.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain(".rb");
  });

  it("accepts all supported extensions", () => {
    const supported = [".mjs", ".js", ".cjs", ".ts", ".mts", ".sh", ".bash", ".py"];
    for (const ext of supported) {
      mkdirSync(join(tmp, "scripts"), { recursive: true });
      const rel = `scripts/x${ext}`;
      writeFileSync(join(tmp, rel), "");
      const g = parseDot(`digraph g {
        start [shape=Mdiamond]
        done [shape=Msquare]
        t [type="tool", cwd="$project", script_file="${rel}"]
        start -> t -> done
      }`);
      const diags = validateGraph(g, tmp);
      expect(
        diags.some(d => d.rule === "unsupported_script_extension"),
        `ext ${ext} should be accepted`,
      ).toBe(false);
    }
  });
});

describe("validateGraph — node sourceLocation", () => {
  it("reachability diagnostic carries node sourceLocation", () => {
    const dot = `digraph g {\n  start [shape="Mdiamond"];\n  done [shape="Msquare"];\n  orphan [shape="box"];\n  start -> done;\n}`;
    const g = parseDot(dot);
    const diags = validateGraph(g);
    const d = diags.find(x => x.rule === "reachability");
    expect(d?.location?.line).toBe(4);
  });
});

describe("validateGraph — edge sourceLocation", () => {
  it("edge_target_exists carries edge sourceLocation", () => {
    const dot = `digraph g {\n  start [shape="Mdiamond"];\n  done [shape="Msquare"];\n  start -> missing;\n}`;
    const g = parseDot(dot);
    const diags = validateGraph(g);
    const d = diags.find(x => x.rule === "edge_target_exists");
    expect(d?.location?.line).toBe(4);
  });
});

describe("validateGraph — schema_error", () => {
  it("validateGraph emits schema_error for tool node missing cwd", () => {
    const graph = parseDot(`
      digraph g {
        start [shape=Mdiamond]
        bad [type="tool", toolCommand="echo hi"]
        done [shape=Msquare]
        start -> bad -> done
      }
    `);
    const diags = validateGraph(graph);
    expect(diags.some(d => d.rule === "schema_error" && d.message.includes("cwd"))).toBe(true);
  });

  it("validateGraph emits schema_error for unknown attribute", () => {
    const graph = parseDot(`
      digraph g {
        start [shape=Mdiamond]
        n [agent="implement", prompt="p", tool_commnd="typo"]
        done [shape=Msquare]
        start -> n -> done
      }
    `);
    const diags = validateGraph(graph);
    // parseDot normalizes snake_case → camelCase before zod sees them, but
    // the diagnostic surfaces the attribute name back in snake_case so it
    // matches what the author wrote in the .dot file.
    expect(diags.some(d => d.rule === "schema_error" && d.message.includes("tool_commnd"))).toBe(true);
  });

  it("validateGraph returns no schema_error for a valid tool node", () => {
    const graph = parseDot(`
      digraph g {
        start [shape=Mdiamond]
        ok [type="tool", cwd="$project", toolCommand="echo hi"]
        done [shape=Msquare]
        start -> ok -> done
      }
    `);
    const diags = validateGraph(graph);
    expect(diags.filter(d => d.rule === "schema_error")).toEqual([]);
  });
});
