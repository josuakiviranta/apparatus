import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

describe("illumination-to-implementation pipeline — full flow validation", () => {
  const root = resolve(__dirname, "../../..");
  const dotPath = resolve(root, ".ralph/pipelines/illumination-to-implementation/pipeline.dot");
  const dotDir = resolve(root, ".ralph/pipelines/illumination-to-implementation");
  const dot = readFileSync(dotPath, "utf-8");
  const graph = parseDot(dot);
  const diags = validateGraph(graph, dotDir);

  it("validates clean (no errors) on the live pipeline post-migration", () => {
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("does NOT require any caller vars (only $project declared, which is RESERVED)", () => {
    const info = diags.find(
      d => d.rule === "required_caller_vars" && d.severity === "info",
    );
    // After the source-as-truth excision (ADR-0004), inputs="project" only.
    // $project is RESERVED → no caller-vars banner expected, OR if emitted,
    // it must not name any of the removed inputs.
    if (info) {
      expect(info.message).not.toMatch(/illuminations_dir|specs_dir|plans_dir/);
    } else {
      expect(info).toBeUndefined();
    }
  });

  it("does NOT emit branch_incomplete_input for $refinements (covered by default_refinements=)", () => {
    const refinementsDiags = diags.filter(
      d =>
        d.rule === "branch_incomplete_input" &&
        /refinements/.test(d.message),
    );
    expect(refinementsDiags).toEqual([]);
  });

  it("retry loop on implement does NOT trip flow rules", () => {
    // The implement → implement cycle. Back-edge is ignored by the analyzer.
    // Assert that no flow-level diagnostic blames the `implement` node for
    // missing or partial inputs.
    const flowRules = new Set([
      "missing_input_producer",
      "branch_incomplete_input",
    ]);
    const implementFlowDiags = diags.filter(
      d => flowRules.has(d.rule) && /node "implement"/.test(d.message),
    );
    expect(implementFlowDiags).toEqual([]);
  });
});
