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
