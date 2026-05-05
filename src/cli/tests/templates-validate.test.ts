import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { getBundledPipelinesDir } from "../lib/assets.js";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";

function loadAndValidate(name: string) {
  const path = join(getBundledPipelinesDir(), name, "pipeline.dot");
  const dot = readFileSync(path, "utf-8");
  const graph = parseDot(dot);
  return validateGraph(graph, dirname(path));
}

describe("bundled pipelines: validateGraph", () => {
  it("meditate has no errors", () => {
    const diags = loadAndValidate("meditate");
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });
});
