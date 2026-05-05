import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolvePipelineArg } from "../lib/pipeline-resolver.js";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";

const REPO_ROOT = resolve(__dirname, "../../..");

describe("src/cli/pipelines/janitor/ — bundled pipeline", () => {
  it("resolves the bare name `janitor` to <repo>/src/cli/pipelines/janitor/pipeline.dot", () => {
    const expected = join(REPO_ROOT, "src", "cli", "pipelines", "janitor", "pipeline.dot");
    expect(existsSync(expected)).toBe(true);
    expect(resolvePipelineArg("janitor", REPO_ROOT)).toBe(expected);
  });

  it("ships janitor.md alongside pipeline.dot for project-local agent resolution", () => {
    const agentPath = join(REPO_ROOT, "src", "cli", "pipelines", "janitor", "janitor.md");
    expect(existsSync(agentPath)).toBe(true);
    expect(readFileSync(agentPath, "utf-8")).toContain("name: janitor");
  });

  it("validateGraph emits zero error-level diagnostics for the migrated pipeline", () => {
    const dotPath = join(REPO_ROOT, "src", "cli", "pipelines", "janitor", "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const diags = validateGraph(graph, dirname(dotPath));
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });
});
