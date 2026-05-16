import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

function setup(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, k), v);
}

describe("validator — inputs_missing_frontmatter", () => {
  it("errors when auto_inputs: true but inputs: omitted", () => {
    const dir = join(tmpdir(), `rule-imf-${Date.now()}`);
    setup(dir, {
      "a.md": `---
name: a
description: x
model: sonnet
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      n [agent="a"]
      done [shape=Msquare]
      start -> n -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "inputs_missing_frontmatter");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/missing required `inputs:` declaration/);
  });

  it("does not fire when auto_inputs: true and inputs: [] is explicit", () => {
    const dir = join(tmpdir(), `rule-imf-empty-${Date.now()}`);
    setup(dir, {
      "a.md": `---
name: a
description: x
model: sonnet
inputs: []
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      n [agent="a"]
      done [shape=Msquare]
      start -> n -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "inputs_missing_frontmatter")).toBeUndefined();
  });

});

describe("validator — unknown_source_node", () => {
  it("errors when inputs reference a non-existent node", () => {
    const dir = join(tmpdir(), `rule-usn-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [ghost.value]
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "unknown_source_node");
    expect(d).toBeDefined();
    expect(d!.message).toMatch(/source node "ghost"/);
  });

  it("does not fire on agents without inputs declaration", () => {
    const dir = join(tmpdir(), `rule-usn-legacy-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "unknown_source_node")).toBeUndefined();
  });

  it("errors when gate inputs reference a non-existent node", () => {
    const dir = join(tmpdir(), `rule-usn-gate-${Date.now()}`);
    setup(dir, {
      "batch_orchestrator.md": `---
name: batch_orchestrator
description: x
model: sonnet
inputs: []
outputs: { done: boolean }
---
body`,
      "tmux_confirm_gate.md": `---
type: gate
choices: [Approve, Retry]
inputs: [implement.done]
---
gate body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      batch_orchestrator [agent="batch_orchestrator"]
      tmux_confirm_gate [shape=hexagon]
      done [shape=Msquare]
      start -> batch_orchestrator -> tmux_confirm_gate -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(
      x => x.rule === "unknown_source_node" && /Gate "tmux_confirm_gate"/.test(x.message),
    );
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/source node "implement"/);
  });
});

describe("validator — source_missing_output_key", () => {
  it("errors when consumer requests a key not in producer outputs:", () => {
    const dir = join(tmpdir(), `rule-smok-${Date.now()}`);
    setup(dir, {
      "producer.md": `---
name: producer
description: x
model: sonnet
inputs: []
outputs: { foo: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [producer.bar]
outputs: { result: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      producer [agent="producer"]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> producer -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "source_missing_output_key");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/producer\.bar/);
    expect(d!.message).toMatch(/"bar"/);
    expect(d!.message).toMatch(/"producer"/);
    expect(d!.message).toMatch(/outputs:/);
  });

  it("does not fire when producer declares the requested key", () => {
    const dir = join(tmpdir(), `rule-smok-ok-${Date.now()}`);
    setup(dir, {
      "producer.md": `---
name: producer
description: x
model: sonnet
inputs: []
outputs: { bar: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [producer.bar]
outputs: { result: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      producer [agent="producer"]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> producer -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "source_missing_output_key")).toBeUndefined();
  });

  it("errors when tool node lacks produces_from_stdout and consumer requests a key", () => {
    const dir = join(tmpdir(), `rule-smok-tool-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [tool_node.bar]
outputs:
  result:
    type: string
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      tool_node [type="tool" cwd="$project" tool_command="echo hello"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> tool_node -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "source_missing_output_key");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/tool_node\.bar/);
    expect(d!.message).toMatch(/"bar"/);
    expect(d!.message).toMatch(/"tool_node"/);
    expect(d!.message).toMatch(/produces_from_stdout/);
  });

  it("does not fire when tool node has produces_from_stdout set", () => {
    const dir = join(tmpdir(), `rule-smok-tool-ok-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [tool_node.bar]
outputs:
  result:
    type: string
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      tool_node [type="tool" cwd="$project" tool_command="echo hello" produces_from_stdout="true"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> tool_node -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "source_missing_output_key")).toBeUndefined();
  });

  it("errors when gate inputs request a key not in producer outputs:", () => {
    const dir = join(tmpdir(), `rule-smok-gate-${Date.now()}`);
    setup(dir, {
      "producer.md": `---
name: producer
description: x
model: sonnet
inputs: []
outputs: { foo: string }
---
body`,
      "my_gate.md": `---
type: gate
choices: [Approve, Retry]
inputs: [producer.bar]
---
gate body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      producer [agent="producer"]
      my_gate [shape=hexagon]
      done [shape=Msquare]
      start -> producer -> my_gate -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(
      x => x.rule === "source_missing_output_key" && /Gate "my_gate"/.test(x.message),
    );
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/producer\.bar/);
    expect(d!.message).toMatch(/"bar"/);
    expect(d!.message).toMatch(/outputs:/);
  });
});

describe("validator — bare_input_not_in_caller_inputs_or_system", () => {
  it("errors when bare input is not in graph inputs= and not a system var", () => {
    const dir = join(tmpdir(), `rule-binis-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [unknown_var]
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "bare_input_not_in_caller_inputs_or_system");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/unknown_var/);
    expect(d!.message).toMatch(/default_/);
  });

  it("does not fire when bare input is declared in graph inputs=", () => {
    const dir = join(tmpdir(), `rule-binis-ok-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [unknown_var]
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      inputs="unknown_var"
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "bare_input_not_in_caller_inputs_or_system")).toBeUndefined();
  });

  it("does not fire for system-injected vars (PROJECT_ROOT, ILLUMINATION_SERVER_PATH)", () => {
    const dir = join(tmpdir(), `rule-binis-sysvar-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [PROJECT_ROOT, ILLUMINATION_SERVER_PATH]
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "bare_input_not_in_caller_inputs_or_system")).toBeUndefined();
  });

  it("does not fire for NODE_ID, PIPELINE_NAME, AGENT_FILE_PATH (new system-injected vars)", () => {
    const dir = join(tmpdir(), `rule-binis-new-sysvars-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [NODE_ID, PIPELINE_NAME, AGENT_FILE_PATH]
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "bare_input_not_in_caller_inputs_or_system")).toBeUndefined();
  });

  it("does not fire on agents without inputs declaration", () => {
    const dir = join(tmpdir(), `rule-binis-legacy-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "bare_input_not_in_caller_inputs_or_system")).toBeUndefined();
  });

  it("does not fire when consumer has default_<localKey> for the bare input", () => {
    const dir = join(tmpdir(), `rule-binis-default-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [optional_thing]
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      c [agent="consumer", default_optional_thing=""]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "bare_input_not_in_caller_inputs_or_system")).toBeUndefined();
  });
});

describe("validator — steering_has_var_token", () => {
  it("errors when auto_inputs node steering prompt contains a $var token", () => {
    const dir = join(tmpdir(), `rule-shvt-${Date.now()}`);
    setup(dir, {
      "x.md": `---
name: x
description: x
model: sonnet
inputs: []
outputs: { result: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      n [agent="x", prompt="hello $foo"]
      done [shape=Msquare]
      start -> n -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "steering_has_var_token");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/\$foo/);
    expect(d!.message).toMatch(/auto_inputs/);
  });

});

describe("validator — rendered_tag_collision", () => {
  it("errors when qualified + bare inputs resolve to the same rendered tag", () => {
    const dir = join(tmpdir(), `rule-rtc-qb-${Date.now()}`);
    setup(dir, {
      "verifier.md": `---
name: verifier
description: x
model: sonnet
inputs: []
outputs: { summary: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [verifier.summary, verifier_summary]
outputs: { result: string }
---
body`,
    });
    const dot = `digraph g {
      inputs="verifier_summary"
      start [shape=Mdiamond]
      verifier [agent="verifier"]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> verifier -> consumer -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "rendered_tag_collision");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/verifier\.summary/);
    expect(d!.message).toMatch(/verifier_summary/);
    expect(d!.message).toMatch(/<verifier_summary>/);
  });

  it("errors on qualified-vs-qualified collision (a.b_c and a_b.c both → a_b_c)", () => {
    const dir = join(tmpdir(), `rule-rtc-qq-${Date.now()}`);
    setup(dir, {
      "a_b.md": `---
name: a_b
description: x
model: sonnet
inputs: []
outputs: { c: string }
---
body`,
      "a.md": `---
name: a
description: x
model: sonnet
inputs: []
outputs: { b_c: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [a_b.c, a.b_c]
outputs: { result: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      a_b [agent="a_b"]
      a [agent="a"]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> a_b -> consumer -> done
      start -> a -> consumer
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "rendered_tag_collision");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/a_b_c/);
  });

  it("does not fire when inputs have distinct rendered tags", () => {
    const dir = join(tmpdir(), `rule-rtc-ok-${Date.now()}`);
    setup(dir, {
      "verifier.md": `---
name: verifier
description: x
model: sonnet
inputs: []
outputs: { summary: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [verifier.summary, project]
outputs: { result: string }
---
body`,
    });
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      verifier [agent="verifier"]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> verifier -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "rendered_tag_collision")).toBeUndefined();
  });

  it("does not fire on agents without inputs declaration", () => {
    const dir = join(tmpdir(), `rule-rtc-legacy-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
outputs: { result: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "rendered_tag_collision")).toBeUndefined();
  });
});

describe("validator — missing_input_producer (qualified inputs)", () => {
  it("fires when verifier is not on every path to consumer (one path bypasses verifier)", () => {
    // Graph: start -> verifier -> consumer -> done
    //        start -> bypass -> consumer
    // consumer has inputs: [verifier.summary] — but 'bypass' path skips verifier
    const dir = join(tmpdir(), `rule-mip-qual-fail-${Date.now()}`);
    setup(dir, {
      "verifier.md": `---
name: verifier
description: x
model: sonnet
inputs: []
outputs: { summary: string }
---
body`,
      "bypass.md": `---
name: bypass
description: x
model: sonnet
inputs: []
outputs: { other: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [verifier.summary]
outputs: { result: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      verifier [agent="verifier"]
      bypass [agent="bypass"]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> verifier -> consumer -> done
      start -> bypass -> consumer
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "missing_input_producer");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/verifier\.summary/);
    expect(d!.message).toMatch(/"consumer"/);
    expect(d!.message).toMatch(/verifier/);
  });

  it("does NOT fire when verifier is on every path to consumer (verifier dominates consumer)", () => {
    // Graph: start -> verifier -> consumer -> done
    //        start -> verifier (single path, verifier dominates consumer)
    const dir = join(tmpdir(), `rule-mip-qual-ok-${Date.now()}`);
    setup(dir, {
      "verifier.md": `---
name: verifier
description: x
model: sonnet
inputs: []
outputs: { summary: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [verifier.summary]
outputs: { result: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      verifier [agent="verifier"]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> verifier -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });

  it("does NOT fire when consumer has a default_ fallback for the qualified input", () => {
    const dir = join(tmpdir(), `rule-mip-qual-default-${Date.now()}`);
    setup(dir, {
      "verifier.md": `---
name: verifier
description: x
model: sonnet
inputs: []
outputs: { summary: string }
---
body`,
      "bypass.md": `---
name: bypass
description: x
model: sonnet
inputs: []
outputs: { other: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [verifier.summary]
outputs: { result: string }
---
body`,
    });
    // consumer node has default_summary= — should suppress the diagnostic
    const dot = `digraph g {
      start [shape=Mdiamond]
      verifier [agent="verifier"]
      bypass [agent="bypass"]
      consumer [agent="consumer", default_summary="fallback"]
      done [shape=Msquare]
      start -> verifier -> consumer -> done
      start -> bypass -> consumer
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });
});

describe("validator — malformed input declarations", () => {
  // resolveInputDecl throws on multi-dot keys (e.g. "a.b.c") and empty strings.
  // validateGraph must NOT crash — it should absorb the throw and continue emitting
  // diagnostics for the rest of the graph. The unknown_source_node rule skips
  // malformed entries; a future dedicated rule can flag them explicitly.
  it("does not throw when inputs contain a multi-dot key (e.g. 'a.b.c')", () => {
    const dir = join(tmpdir(), `rule-malformed-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [a.b.c]
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    // Must not throw — malformed decls are skipped inside unknown_source_node
    expect(() => validateGraph(graph, dir)).not.toThrow();
  });
});

describe("validator — bare_input_from_qualified_producer", () => {
  it("errors when consumer declares bare input whose source is produces_from_stdout tool node", () => {
    const dir = join(tmpdir(), `rule-bipq-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [vision]
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      read_vision [type="tool", cwd="$project", tool_command="echo {}", produces_from_stdout=true]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> read_vision -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "bare_input_from_qualified_producer");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toContain("vision");
    expect(d!.message).toContain("read_vision.vision");
  });

  it("default_* attribute does NOT silence bare_input_from_qualified_producer", () => {
    const dir = join(tmpdir(), `rule-bipq-default-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
model: sonnet
inputs: [vision]
outputs: { foo: string }
---
body`,
    });
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      read_vision [type="tool", cwd="$project", tool_command="echo {}", produces_from_stdout=true]
      consumer [agent="consumer", default_vision=""]
      done [shape=Msquare]
      start -> read_vision -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.some(d => d.rule === "bare_input_from_qualified_producer")).toBe(true);
  });

  it("bare input from caller-var (declared on digraph) does NOT trigger the rule", () => {
    const dir = join(tmpdir(), `rule-bipq-caller-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---\nname: consumer\ndescription: x\ninputs: [vision]\noutputs: { foo: string }\n---\nbody`,
    });
    const dot = `digraph g {
      inputs="project,vision"
      start [shape=Mdiamond]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.some(d => d.rule === "bare_input_from_qualified_producer")).toBe(false);
  });

  it("bare input from reserved system var does NOT trigger the rule", () => {
    const dir = join(tmpdir(), `rule-bipq-reserved-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---\nname: consumer\ndescription: x\ninputs: [project]\noutputs: { foo: string }\n---\nbody`,
    });
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.some(d => d.rule === "bare_input_from_qualified_producer")).toBe(false);
  });

  it("qualified input from produces_from_stdout source passes validation", () => {
    const dir = join(tmpdir(), `rule-bipq-qualified-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---\nname: consumer\ndescription: x\ninputs: [read_vision.vision]\noutputs: { foo: string }\n---\nbody`,
    });
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      read_vision [type="tool", cwd="$project", tool_command="echo {}", produces_from_stdout=true]
      consumer [agent="consumer"]
      done [shape=Msquare]
      start -> read_vision -> consumer -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.some(d => d.rule === "bare_input_from_qualified_producer")).toBe(false);
  });
});
