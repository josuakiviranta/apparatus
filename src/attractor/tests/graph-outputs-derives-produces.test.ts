import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

describe("validator — derive produces from agent outputs", () => {
  it("treats agent's outputs keys as produced when node.produces unset (no missing_input_producer for downstream consumer)", () => {
    const dir = join(tmpdir(), `produces-derive-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "verifier.md"), `---
name: verifier
description: verifier
auto_inputs: true
outputs:
  preferred_label: {enum: ["true", "false"]}
  summary: string
---
body
`);
    writeFileSync(join(dir, "consumer.md"), `---
name: consumer
description: consumes preferred_label
auto_inputs: true
inputs:
  - preferred_label
---
body
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      v [agent="verifier"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> v -> c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    expect(diags.find(d => d.rule === "agent_produces_unknown")).toBeUndefined();
    // Derivation works: consumer sees preferred_label in scope → no missing_input_producer
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });

  it("skips derivation when dotDir is undefined (no filesystem context)", () => {
    const dot = `digraph g { v [agent="verifier"]; v -> done; }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph);
    expect(diags.every(d => d.rule !== "agent_file_unresolvable")).toBe(true);
  });

  it("falls back to node.produces when agent file has no outputs (downstream consumer sees key in scope)", () => {
    const dir = join(tmpdir(), `produces-fallback-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "legacy.md"), `---
name: legacy
description: legacy
auto_inputs: true
---
body
`);
    writeFileSync(join(dir, "consumer.md"), `---
name: consumer
description: consumes manual_key
auto_inputs: true
inputs:
  - manual_key
---
body
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      v [agent="legacy", produces="manual_key"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> v -> c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    // node.produces="manual_key" should satisfy consumer's input requirement
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });
});
