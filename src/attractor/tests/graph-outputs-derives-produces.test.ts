import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

describe("validator — derive produces from agent outputs", () => {
  it("treats agent's outputs keys as produced when node.produces unset", () => {
    const dir = join(tmpdir(), `produces-derive-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "verifier.md"), `---
name: verifier
description: verifier
outputs:
  preferred_label: {enum: ["true", "false"]}
  summary: string
---
body
`);
    const dot = `digraph g {
      v [agent="verifier"]
      v -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    expect(diags.find(d => d.rule === "agent_produces_unknown")).toBeUndefined();
    expect((graph as any).debugProducedKeys?.get("v")).toEqual(
      new Set(["preferred_label", "summary"])
    );
  });

  it("skips derivation when dotDir is undefined (no filesystem context)", () => {
    const dot = `digraph g { v [agent="verifier"]; v -> done; }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph);
    expect(diags.every(d => d.rule !== "agent_file_unresolvable")).toBe(true);
  });

  it("falls back to node.produces when agent file has no outputs", () => {
    const dir = join(tmpdir(), `produces-fallback-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "legacy.md"), `---
name: legacy
description: legacy
---
body
`);
    const dot = `digraph g { v [agent="legacy", produces="manual_key"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    validateGraph(graph, dir);
    expect((graph as any).debugProducedKeys?.get("v")).toContain("manual_key");
  });
});
