import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDot, validateGraph } from "../../attractor/core/graph.js";

const REPO_ROOT = resolve(__dirname, "../../..");
const DOT_PATH = join(REPO_ROOT, "src", "cli", "pipelines", "implement", "pipeline.dot");

describe("src/cli/pipelines/implement/pipeline.dot — scenario branch", () => {
  it("declares an `implementer` node bound to agent='implement'", () => {
    const dot = readFileSync(DOT_PATH, "utf-8");
    expect(dot).toMatch(/implementer\s*\[[^\]]*agent="implement"/);
  });

  it("declares a `record_base` tool node that captures git HEAD as JSON", () => {
    const dot = readFileSync(DOT_PATH, "utf-8");
    expect(dot).toMatch(/record_base\s*\[/);
    expect(dot).toMatch(/tool_command="printf .*\\"sha\\":\\".*git rev-parse HEAD/);
    expect(dot).toMatch(/produces_from_stdout="true"/);
  });

  it("wires start -> record_base -> implementer", () => {
    const dot = readFileSync(DOT_PATH, "utf-8");
    expect(dot).toMatch(/start\s*->\s*record_base/);
    expect(dot).toMatch(/record_base\s*->\s*implementer/);
  });

  it("validateGraph emits zero error-level diagnostics", () => {
    const graph = parseDot(readFileSync(DOT_PATH, "utf-8"));
    const diags = validateGraph(graph, dirname(DOT_PATH));
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });
});
