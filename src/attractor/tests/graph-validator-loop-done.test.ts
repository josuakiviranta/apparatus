import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

describe("validator — loop_missing_done_field", () => {
  it("errors when loop:true agent has no done field in outputs", () => {
    const dir = join(tmpdir(), `loop-done-missing-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "looper.md"), `---
name: looper
description: a looping agent missing done
auto_inputs: true
loop: true
outputs:
  result: string
---
Loop body.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      loop_node [agent="looper"]
      exit [shape=Msquare]
      start -> loop_node
      loop_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const errorDiag = diags.find(d => d.rule === "loop_missing_done_field");
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.severity).toBe("error");
    expect(errorDiag?.message).toContain("done");
    expect(errorDiag?.message).toContain("loop:true");
  });

  it("errors when loop:true agent has done with non-boolean type", () => {
    const dir = join(tmpdir(), `loop-done-nonbool-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "looper.md"), `---
name: looper
description: a looping agent with wrong-typed done
auto_inputs: true
loop: true
outputs:
  done: string
---
Loop body.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      loop_node [agent="looper"]
      exit [shape=Msquare]
      start -> loop_node
      loop_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const errorDiag = diags.find(d => d.rule === "loop_missing_done_field");
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.severity).toBe("error");
  });

  it("accepts loop:true with done:boolean shorthand", () => {
    const dir = join(tmpdir(), `loop-done-shorthand-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "looper.md"), `---
name: looper
description: a looping agent with shorthand done
auto_inputs: true
loop: true
outputs:
  done: boolean
  result: string
---
Loop body.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      loop_node [agent="looper"]
      exit [shape=Msquare]
      start -> loop_node
      loop_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const errorDiag = diags.find(d => d.rule === "loop_missing_done_field");
    expect(errorDiag).toBeUndefined();
  });

  it("accepts loop:true with done long form { type: boolean }", () => {
    const dir = join(tmpdir(), `loop-done-longform-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "looper.md"), `---
name: looper
description: a looping agent with long-form done
auto_inputs: true
loop: true
outputs:
  done:
    type: boolean
  result: string
---
Loop body.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      loop_node [agent="looper"]
      exit [shape=Msquare]
      start -> loop_node
      loop_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const errorDiag = diags.find(d => d.rule === "loop_missing_done_field");
    expect(errorDiag).toBeUndefined();
  });

  it("loop:true + outputs:{} fires loop_missing_done_field and suppresses agent_outputs_empty", () => {
    const dir = join(tmpdir(), `loop-done-empty-outputs-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "looper.md"), `---
name: looper
description: a looping agent with empty outputs
auto_inputs: true
loop: true
outputs: {}
---
Loop body.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      loop_node [agent="looper"]
      exit [shape=Msquare]
      start -> loop_node
      loop_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const errorDiag = diags.find(d => d.rule === "loop_missing_done_field");
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.severity).toBe("error");

    const emptyWarn = diags.find(d => d.rule === "agent_outputs_empty");
    expect(emptyWarn).toBeUndefined();
  });

  it("loop:false (default / unset) does NOT trigger the rule", () => {
    const dir = join(tmpdir(), `loop-done-default-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plain.md"), `---
name: plain
description: a non-looping agent
auto_inputs: true
outputs:
  result: string
---
Plain body.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      plain_node [agent="plain"]
      exit [shape=Msquare]
      start -> plain_node
      plain_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const errorDiag = diags.find(d => d.rule === "loop_missing_done_field");
    expect(errorDiag).toBeUndefined();
  });
});
