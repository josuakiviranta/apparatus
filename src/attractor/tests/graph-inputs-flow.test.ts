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

describe("validator — branch_incomplete_input", () => {
  it("errors when only one branch of a diamond produces the input", () => {
    const dir = join(tmpdir(), `bii-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "producer.md"), `---
name: producer
description: produces foo
outputs:
  foo: string
---
body
`);
    writeFileSync(join(dir, "passthrough.md"), `---
name: passthrough
description: does not produce foo
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
    // Diamond: start -> {p (produces foo), q (does not)} -> c
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      p [agent="producer"]
      q [agent="passthrough"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> p
      start -> q
      p -> c
      q -> c
      c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "branch_incomplete_input");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/input "foo"/);
    // missing_input_producer should NOT fire — producer exists on some path
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });

  it("does not fire when both branches produce the input", () => {
    const dir = join(tmpdir(), `bii-both-${Date.now()}`);
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
      inputs="project"
      start [shape=Mdiamond]
      p1 [agent="producer"]
      p2 [agent="producer"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> p1
      start -> p2
      p1 -> c
      p2 -> c
      c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "branch_incomplete_input")).toBeUndefined();
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });

  it("default_<key>= on the consumer node suppresses the rule", () => {
    const dir = join(tmpdir(), `bii-default-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "producer.md"), `---
name: producer
description: produces foo
outputs:
  foo: string
---
body
`);
    writeFileSync(join(dir, "passthrough.md"), `---
name: passthrough
description: does not produce foo
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
      inputs="project"
      start [shape=Mdiamond]
      p [agent="producer"]
      q [agent="passthrough"]
      c [agent="consumer", default_foo="fallback"]
      done [shape=Msquare]
      start -> p
      start -> q
      p -> c
      q -> c
      c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "branch_incomplete_input")).toBeUndefined();
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });

  it("missing_input_producer (not branch_incomplete_input) fires when no path produces the key", () => {
    const dir = join(tmpdir(), `bii-none-${Date.now()}`);
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
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeDefined();
    expect(diags.find(d => d.rule === "branch_incomplete_input")).toBeUndefined();
  });
});

describe("validator — input_type_mismatch", () => {
  function setupClassifierFixture(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "classifier.md"), `---
name: classifier
description: emits preferred_label
outputs:
  preferred_label:
    enum:
      - "true"
      - "false"
      - "empty"
---
body
`);
    writeFileSync(join(dir, "next.md"), `---
name: next
description: downstream
---
body
`);
  }

  it("errors when condition value is not a member of producer's outputs.enum", () => {
    const dir = join(tmpdir(), `itm-typo-${Date.now()}`);
    setupClassifierFixture(dir);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      cls [agent="classifier"]
      n [agent="next"]
      done [shape=Msquare]
      start -> cls
      cls -> n [condition="preferred_label=tru"]
      n -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "input_type_mismatch");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/preferred_label/);
    expect(d!.message).toMatch(/"tru"/);
    expect(d!.message).toMatch(/true.*false.*empty/);
  });

  it("does not fire when condition value is in enum", () => {
    const dir = join(tmpdir(), `itm-ok-${Date.now()}`);
    setupClassifierFixture(dir);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      cls [agent="classifier"]
      n [agent="next"]
      done [shape=Msquare]
      start -> cls
      cls -> n [condition="preferred_label=true"]
      n -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "input_type_mismatch")).toBeUndefined();
  });

  it("does not fire when producer declares no enum", () => {
    const dir = join(tmpdir(), `itm-noenum-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "producer.md"), `---
name: producer
description: emits foo with no enum
outputs:
  foo: string
---
body
`);
    writeFileSync(join(dir, "next.md"), `---
name: next
description: downstream
---
body
`);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      p [agent="producer"]
      n [agent="next"]
      done [shape=Msquare]
      start -> p
      p -> n [condition="foo=anything"]
      n -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "input_type_mismatch")).toBeUndefined();
  });

  it("ignores outcome= conditions (pipeline-level status, not user output)", () => {
    const dir = join(tmpdir(), `itm-outcome-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "agent.md"), `---
name: a
description: anything
---
body
`);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      a [agent="a"]
      n [agent="a"]
      done [shape=Msquare]
      start -> a
      a -> n [condition="outcome=success"]
      n -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "input_type_mismatch")).toBeUndefined();
  });

  it("catches typo in compound &&-condition", () => {
    const dir = join(tmpdir(), `itm-compound-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "classifier.md"), `---
name: classifier
description: emits two outputs
outputs:
  preferred_label:
    enum:
      - "true"
      - "false"
  status:
    enum:
      - "ok"
      - "fail"
---
body
`);
    writeFileSync(join(dir, "next.md"), `---
name: next
description: downstream
---
body
`);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      cls [agent="classifier"]
      n [agent="next"]
      done [shape=Msquare]
      start -> cls
      cls -> n [condition="preferred_label=true&&status=fial"]
      n -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "input_type_mismatch");
    expect(d).toBeDefined();
    expect(d!.message).toMatch(/status/);
    expect(d!.message).toMatch(/"fial"/);
  });

  it("validates value on != operator too (catches typo on negative match)", () => {
    const dir = join(tmpdir(), `itm-neq-${Date.now()}`);
    setupClassifierFixture(dir);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      cls [agent="classifier"]
      n [agent="next"]
      done [shape=Msquare]
      start -> cls
      cls -> n [condition="preferred_label!=tru"]
      n -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "input_type_mismatch");
    expect(d).toBeDefined();
    expect(d!.message).toMatch(/"tru"/);
  });

  it("strips surrounding single quotes before comparing", () => {
    const dir = join(tmpdir(), `itm-quotes-${Date.now()}`);
    setupClassifierFixture(dir);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      cls [agent="classifier"]
      n [agent="next"]
      done [shape=Msquare]
      start -> cls
      cls -> n [condition="preferred_label='true'"]
      n -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "input_type_mismatch")).toBeUndefined();
  });
});
