import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipelineShowCommand } from "../commands/pipeline.js";

describe("pipeline show annotates SVG with declared inputs/outputs", () => {
  it("includes inputs and outputs keys on agent nodes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "show-"));
    mkdirSync(join(dir, "p"));
    writeFileSync(
      join(dir, "p", "verifier.md"),
      `---
name: verifier
description: x
model: opus
permissionMode: default
tools: []
mcp: []
inputs: [foo]
outputs:
  preferred_label: {enum: [true, false, empty]}
  summary: string
---
verify
`,
    );
    writeFileSync(
      join(dir, "p", "pipeline.dot"),
      `digraph p {
  goal="t"
  inputs="foo"
  start [shape=Mdiamond]
  done [shape=Msquare]
  verifier [agent="verifier", prompt="do"]
  start -> verifier -> done
}`,
    );
    const exit = await pipelineShowCommand(join(dir, "p", "pipeline.dot"), {});
    expect(exit).toBe(0);
    const svg = readFileSync(join(dir, "p", "pipeline.svg"), "utf8");
    expect(svg).toContain("preferred_label");
    expect(svg).toContain("summary");
    expect(svg).toContain("foo");
  });
});
