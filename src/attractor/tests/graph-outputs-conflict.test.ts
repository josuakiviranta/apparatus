import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

describe("validator — outputs/jsonSchemaFile conflict", () => {
  it("emits outputs_and_schema_file_conflict when both are present", () => {
    const dir = join(tmpdir(), `outputs-conflict-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "verifier.md"), `---
name: verifier
description: verifier agent
auto_inputs: true
outputs:
  foo: string
---
prompt body
`);
    const dot = `digraph g {
      v [agent="verifier", json_schema_file="schemas/verifier.json"]
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    expect(diags.some(d =>
      d.rule === "outputs_and_schema_file_conflict" && d.severity === "error"
    )).toBe(true);
  });

  it("emits produces_redundant_with_outputs as error when redeclared", () => {
    const dir = join(tmpdir(), `produces-redundant-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "verifier.md"), `---
name: verifier
description: verifier agent
auto_inputs: true
outputs:
  foo: string
  bar: number
---
prompt
`);
    const dot = `digraph g {
      v [agent="verifier", produces="foo, bar"]
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    expect(diags.some(d =>
      d.rule === "produces_redundant_with_outputs" && d.severity === "error"
    )).toBe(true);
  });

  it("does not crash when dotDir is undefined", () => {
    const dot = `digraph g {
      v [agent="some-bundled-agent", json_schema_file="x.json"]
    }`;
    const graph = parseDot(dot);
    expect(() => validateGraph(graph, undefined)).not.toThrow();
  });
});
