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

describe("validator — outputs_schema_invalid", () => {
  it("flags an agent whose outputs: shape would throw at runtime (string[] shorthand)", () => {
    const dir = join(tmpdir(), `outputs-schema-1-${Date.now()}`);
    setupAgents(dir, {
      "broken.md": `---
name: broken
description: declares an unsupported shorthand
auto_inputs: true
outputs:
  paths: string[]
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      b [agent="broken"]
      done [shape=Msquare]
      start -> b -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const errs = diags.filter(d => d.rule === "outputs_schema_invalid");
    expect(errs).toHaveLength(1);
    expect(errs[0].severity).toBe("error");
    expect(errs[0].message).toContain("broken");
    expect(errs[0].message).toContain("paths");
    expect(errs[0].message).toMatch(/string\[\]/);
    expect(errs[0].location?.line).toBe(graph.nodes.get("b")?.sourceLocation?.line);
  });

  it("does not flag a valid outputs: shape (array object form)", () => {
    const dir = join(tmpdir(), `outputs-schema-2-${Date.now()}`);
    setupAgents(dir, {
      "okay.md": `---
name: okay
description: declares a supported array shape
auto_inputs: true
outputs:
  paths: {type: array, items: string}
  count: number
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      o [agent="okay"]
      done [shape=Msquare]
      start -> o -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const errs = diags.filter(d => d.rule === "outputs_schema_invalid");
    expect(errs).toEqual([]);
  });
});
