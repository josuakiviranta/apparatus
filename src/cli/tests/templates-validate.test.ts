import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { getBundledTemplatesDir } from "../lib/assets.js";
import { parseDot, validateGraph } from "../../attractor/core/graph.js";
import { parseAgentFile } from "../lib/agent-registry.js";

function loadAndValidate(templateName: string) {
  const path = join(getBundledTemplatesDir(), templateName, "pipeline.dot");
  const dot = readFileSync(path, "utf-8");
  const graph = parseDot(dot);
  return validateGraph(graph, dirname(path));
}

describe("bundled templates: validateGraph", () => {
  it("blank has no errors", () => {
    const diags = loadAndValidate("blank");
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("pipeline-create has no errors", () => {
    const diags = loadAndValidate("pipeline-create");
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("plan has no errors", () => {
    const diags = loadAndValidate("plan");
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("meditate has no errors", () => {
    const diags = loadAndValidate("meditate");
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("pipeline-create scaffolder agent", () => {
  it("declares pipeline_name and pipelines_dir as inputs", () => {
    const path = join(getBundledTemplatesDir(), "pipeline-create", "scaffolder.md");
    const cfg = parseAgentFile(readFileSync(path, "utf-8"));
    expect(cfg.inputs).toContain("pipeline_name");
    expect(cfg.inputs).toContain("pipelines_dir");
  });
});
