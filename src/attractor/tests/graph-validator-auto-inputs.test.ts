import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

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
auto_inputs: true
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
auto_inputs: true
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

  it("does not fire on legacy agents without auto_inputs", () => {
    const dir = join(tmpdir(), `rule-imf-legacy-${Date.now()}`);
    setup(dir, {
      "a.md": `---
name: a
description: x
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
auto_inputs: true
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

  it("does not fire on legacy agents without auto_inputs", () => {
    const dir = join(tmpdir(), `rule-usn-legacy-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
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
});

describe("validator — source_missing_output_key", () => {
  it("errors when consumer requests a key not in producer outputs:", () => {
    const dir = join(tmpdir(), `rule-smok-${Date.now()}`);
    setup(dir, {
      "producer.md": `---
name: producer
description: x
auto_inputs: true
inputs: []
outputs: { foo: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
auto_inputs: true
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
auto_inputs: true
inputs: []
outputs: { bar: string }
---
body`,
      "consumer.md": `---
name: consumer
description: x
auto_inputs: true
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
auto_inputs: true
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
auto_inputs: true
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
});

describe("validator — bare_input_not_in_caller_inputs_or_system", () => {
  it("errors when bare input is not in graph inputs= and not a system var", () => {
    const dir = join(tmpdir(), `rule-binis-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
auto_inputs: true
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
  });

  it("does not fire when bare input is declared in graph inputs=", () => {
    const dir = join(tmpdir(), `rule-binis-ok-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
auto_inputs: true
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

  it("does not fire for system-injected vars (PROJECT_ROOT, ILLUMINATION_SERVER_PATH, META_MEDITATIONS_DIR)", () => {
    const dir = join(tmpdir(), `rule-binis-sysvar-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
auto_inputs: true
inputs: [PROJECT_ROOT, ILLUMINATION_SERVER_PATH, META_MEDITATIONS_DIR]
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

  it("does not fire on legacy agents without auto_inputs", () => {
    const dir = join(tmpdir(), `rule-binis-legacy-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
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
});

describe("validator — steering_has_var_token", () => {
  it("errors when auto_inputs node steering prompt contains a $var token", () => {
    const dir = join(tmpdir(), `rule-shvt-${Date.now()}`);
    setup(dir, {
      "x.md": `---
name: x
description: x
auto_inputs: true
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

  it("does not fire on legacy agents without auto_inputs even if prompt has $var", () => {
    const dir = join(tmpdir(), `rule-shvt-legacy-${Date.now()}`);
    setup(dir, {
      "x.md": `---
name: x
description: x
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
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "steering_has_var_token")).toBeUndefined();
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
auto_inputs: true
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
