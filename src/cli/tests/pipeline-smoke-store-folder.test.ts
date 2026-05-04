import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDot, validateGraph } from "../../attractor/core/graph.js";

const REPO_ROOT = resolve(__dirname, "../../..");

describe(".ralph/scenarios/store/ — chunk-4 per-folder migration", () => {
  it("pipeline.dot exists at <repo>/.ralph/scenarios/store/pipeline.dot", () => {
    const expected = join(REPO_ROOT, ".ralph", "scenarios", "store", "pipeline.dot");
    expect(existsSync(expected)).toBe(true);
  });

  it("validateGraph emits zero error-level diagnostics for the migrated pipeline", () => {
    const dotPath = join(REPO_ROOT, ".ralph", "scenarios", "store", "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const diags = validateGraph(graph, dirname(dotPath));
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });
});
