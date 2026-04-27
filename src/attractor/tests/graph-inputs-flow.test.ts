import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

describe("validator — missing_input_producer", () => {
  it("errors when an agent's declared input has no producer on every path", () => {
    const dir = join(tmpdir(), `mip-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "consumer.md"), `---
name: consumer
description: needs foo
inputs:
  - foo
---
body
`);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "missing_input_producer");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/input "foo"/);
  });

  it("does not fire when an upstream node produces the input", () => {
    const dir = join(tmpdir(), `mip-ok-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "producer.md"), `---
name: producer
description: produces foo
outputs:
  foo: string
---
body
`);
    writeFileSync(join(dir, "consumer.md"), `---
name: consumer
description: needs foo
inputs:
  - foo
---
body
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> p -> c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });

  it("caller-input on the digraph satisfies the requirement", () => {
    const dir = join(tmpdir(), `mip-caller-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "consumer.md"), `---
name: consumer
description: needs project
inputs:
  - project
---
body
`);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });

  it("default_<key>= on the consumer node satisfies the requirement", () => {
    const dir = join(tmpdir(), `mip-default-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "consumer.md"), `---
name: consumer
description: needs foo
inputs:
  - foo
---
body
`);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      c [agent="consumer", default_foo="bar"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });
});
