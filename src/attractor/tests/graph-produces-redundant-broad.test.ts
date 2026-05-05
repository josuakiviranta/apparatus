import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

function setupAgent(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "verifier.md"), `---
name: verifier
description: verifier
auto_inputs: true
outputs:
  foo: string
  bar: number
---
body
`);
}

describe("produces_redundant_with_outputs — broad (D2)", () => {
  it("errors on exact match (was warning before)", () => {
    const dir = join(tmpdir(), `prw-exact-${Date.now()}`);
    setupAgent(dir);
    const dot = `digraph g { v [agent="verifier", produces="foo, bar"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "produces_redundant_with_outputs");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
  });

  it("errors on subset (produces=\"foo\" when outputs has foo+bar)", () => {
    const dir = join(tmpdir(), `prw-subset-${Date.now()}`);
    setupAgent(dir);
    const dot = `digraph g { v [agent="verifier", produces="foo"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "produces_redundant_with_outputs");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/foo/);
  });

  it("errors on superset (produces declares a key the agent does not output)", () => {
    const dir = join(tmpdir(), `prw-super-${Date.now()}`);
    setupAgent(dir);
    const dot = `digraph g { v [agent="verifier", produces="foo, bar, baz"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "produces_redundant_with_outputs");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/baz/);
  });

  it("errors on disjoint (produces declares only keys the agent does not output)", () => {
    const dir = join(tmpdir(), `prw-disjoint-${Date.now()}`);
    setupAgent(dir);
    const dot = `digraph g { v [agent="verifier", produces="qux"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "produces_redundant_with_outputs");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
  });

  it("does not fire on whitespace-only produces (\" , , \")", () => {
    const dir = join(tmpdir(), `prw-ws-${Date.now()}`);
    setupAgent(dir);
    const dot = `digraph g { v [agent="verifier", produces=" , , "]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "produces_redundant_with_outputs")).toBeUndefined();
  });

  it("does not fire when agent has no outputs (legacy nodes still allowed produces=)", () => {
    const dir = join(tmpdir(), `prw-legacy-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "legacy.md"), `---
name: legacy
description: legacy
auto_inputs: true
---
body
`);
    const dot = `digraph g { v [agent="legacy", produces="foo"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "produces_redundant_with_outputs")).toBeUndefined();
  });
});
