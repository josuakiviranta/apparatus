import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

function setupAgents(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
}

describe("validator — orphan_output", () => {
  it("warns when an agent's outputs key has no downstream consumer", () => {
    const dir = join(tmpdir(), `orphan-output-1-${Date.now()}`);
    setupAgents(dir, {
      "producer.md": `---
name: producer
description: produces stale_key + active_key
auto_inputs: true
outputs:
  stale_key: string
  active_key: string
---
body
`,
      "consumer.md": `---
name: consumer
description: consumes active_key
auto_inputs: true
inputs:
  - active_key
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> p -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const orphans = diags.filter(d => d.rule === "orphan_output");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].severity).toBe("warning");
    expect(orphans[0].message).toContain("stale_key");
    expect(orphans[0].message).toContain("producer");
    expect(orphans[0].location?.line).toBe(graph.nodes.get("p")?.sourceLocation?.line);
  });

  it("does not warn when an outputs key is consumed via downstream agent inputs", () => {
    const dir = join(tmpdir(), `orphan-output-2-${Date.now()}`);
    setupAgents(dir, {
      "producer.md": `---
name: producer
description: produces summary
auto_inputs: true
outputs:
  summary: string
---
body
`,
      "consumer.md": `---
name: consumer
description: consumes summary
auto_inputs: true
inputs:
  - summary
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> p -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "orphan_output")).toBeUndefined();
  });

  it("does not warn when an outputs key is consumed via condition=", () => {
    const dir = join(tmpdir(), `orphan-output-3-${Date.now()}`);
    setupAgents(dir, {
      "verifier.md": `---
name: verifier
description: verifier
auto_inputs: true
outputs:
  preferred_label:
    enum: ["true", "false"]
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      v [agent="verifier"]
      done [shape=Msquare]
      start -> v
      v -> done [condition="preferred_label=true"]
      v -> done [condition="preferred_label=false"]
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "orphan_output")).toBeUndefined();
  });

  it("does not warn when an outputs key is referenced via $key in a downstream prompt", () => {
    const dir = join(tmpdir(), `orphan-output-4-${Date.now()}`);
    setupAgents(dir, {
      "producer.md": `---
name: producer
description: produces summary
auto_inputs: true
outputs:
  summary: string
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      c [type="codergen", prompt="Recap: $summary"]
      done [shape=Msquare]
      start -> p -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "orphan_output")).toBeUndefined();
  });

  it("does not warn when an outputs key is referenced via $key in a gate label", () => {
    const dir = join(tmpdir(), `orphan-output-5-${Date.now()}`);
    setupAgents(dir, {
      "producer.md": `---
name: producer
description: produces topic
auto_inputs: true
outputs:
  topic: string
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      gate [shape=hexagon, label="Pick for $topic"]
      done [shape=Msquare]
      start -> p -> gate -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "orphan_output")).toBeUndefined();
  });

  it("warns only on the unconsumed key when an agent has multiple outputs", () => {
    const dir = join(tmpdir(), `orphan-output-6-${Date.now()}`);
    setupAgents(dir, {
      "producer.md": `---
name: producer
description: produces a + b
auto_inputs: true
outputs:
  a: string
  b: string
---
body
`,
      "consumer.md": `---
name: consumer
description: consumes a
auto_inputs: true
inputs:
  - a
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> p -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const orphans = diags.filter(d => d.rule === "orphan_output");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].message).toContain("b");
    expect(orphans[0].message).not.toContain('"a"');
  });

  it("does not run when dotDir is undefined (no filesystem context)", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      done [shape=Msquare]
      start -> p -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph);
    expect(diags.find(d => d.rule === "orphan_output")).toBeUndefined();
  });

  it("does not warn when an outputs key is consumed via a downstream agent's qualified input (someNode.value)", () => {
    const dir = join(tmpdir(), `orphan-output-qualified-agent-${Date.now()}`);
    setupAgents(dir, {
      "producer.md": `---
name: producer
description: produces value
auto_inputs: true
outputs:
  value: string
---
body
`,
      "consumer.md": `---
name: consumer
description: consumes someNode.value
auto_inputs: true
inputs:
  - someNode.value
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      someNode [agent="producer"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> someNode -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "orphan_output")).toBeUndefined();
  });

  it("does not warn when an outputs key is consumed via a gate's qualified input (someNode.output)", () => {
    const dir = join(tmpdir(), `orphan-output-qualified-gate-${Date.now()}`);
    setupAgents(dir, {
      "producer.md": `---
name: producer
description: produces output
auto_inputs: true
outputs:
  output: string
---
body
`,
    });
    writeFileSync(join(dir, "gate.md"), `---
type: gate
choices:
  - ok
inputs:
  - someNode.output
---
Pick.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      someNode [agent="producer"]
      gate [shape=hexagon]
      done [shape=Msquare]
      start -> someNode -> gate
      gate -> done [label="ok"]
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "orphan_output")).toBeUndefined();
  });

  it("does not warn about `done` output on a loop:true agent even when no downstream node consumes it", () => {
    const dir = join(tmpdir(), `orphan-output-loop-done-${Date.now()}`);
    setupAgents(dir, {
      "looper.md": `---
name: looper
description: loops until done
auto_inputs: true
loop: true
outputs:
  done: boolean
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      l [agent="looper"]
      done [shape=Msquare]
      start -> l -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const orphans = diags.filter(d => d.rule === "orphan_output");
    expect(orphans.find(d => d.message.includes('"done"'))).toBeUndefined();
  });
});
