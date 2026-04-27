import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { getBundledTemplatesDir } from "../lib/assets.js";
import { parseDot, validateGraph } from "../../attractor/core/graph.js";

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
});
