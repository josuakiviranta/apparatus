import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";

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
    expect(dot).toMatch(/record_base\s*\[[^\]]*type="tool"/);
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

  it("scenario-author.md exists with proper frontmatter", () => {
    const agentPath = join(REPO_ROOT, "src", "cli", "pipelines", "implement", "scenario-author.md");
    expect(existsSync(agentPath)).toBe(true);
    const content = readFileSync(agentPath, "utf-8");
    expect(content).toContain("name: scenario-author");
    expect(content).toMatch(/inputs:\s*\n(\s*-\s*[\w.]+\s*\n){2,}/);
    expect(content).toContain("scenarios_dir");
    expect(content).not.toContain("specs_dir");
    expect(content).toContain("record_base.sha");
    expect(content).toMatch(/outputs:[\s\S]*tests_written:\s*boolean/);
    expect(content).not.toMatch(/outputs:[\s\S]*scenario_paths/);
    expect(content).not.toMatch(/outputs:[\s\S]*\n\s*summary:/);
  });

  it("declares a scenario_author agent node", () => {
    const dot = readFileSync(DOT_PATH, "utf-8");
    expect(dot).toMatch(/scenario_author\s*\[[^\]]*agent="scenario-author"/);
  });

  it("routes implementer on scenarios_dir presence: skip to done when empty, scenario_author when populated", () => {
    const dot = readFileSync(DOT_PATH, "utf-8");
    expect(dot).toMatch(/implementer\s*->\s*scenario_author\s*\[[^\]]*condition="scenarios_dir!=''"/);
    expect(dot).toMatch(/implementer\s*->\s*done\s*\[[^\]]*condition="scenarios_dir=''"/);
  });

  it("implementation-tester.md exists with proper frontmatter", () => {
    const agentPath = join(REPO_ROOT, "src", "cli", "pipelines", "implement", "implementation-tester.md");
    expect(existsSync(agentPath)).toBe(true);
    const content = readFileSync(agentPath, "utf-8");
    expect(content).toContain("name: implementation-tester");
    expect(content).toContain("scenarios_dir");
    expect(content).toMatch(/outputs:[\s\S]*test_result/);
    expect(content).not.toMatch(/outputs:[\s\S]*test_summary/);
    expect(content).not.toMatch(/outputs:[\s\S]*test_render/);
  });

  it("declares an implementation_tester node and a commit_push tool node", () => {
    const dot = readFileSync(DOT_PATH, "utf-8");
    expect(dot).toMatch(/implementation_tester\s*\[[^\]]*agent="implementation-tester"/);
    expect(dot).toMatch(/commit_push\s*\[[^\]]*tool_command="git push origin/);
  });

  it("gates scenario_author on tests_written and tester on test_result", () => {
    const dot = readFileSync(DOT_PATH, "utf-8");
    expect(dot).toMatch(/scenario_author\s*->\s*implementation_tester\s*\[[^\]]*condition="tests_written=true"/);
    expect(dot).toMatch(/scenario_author\s*->\s*done\s*\[[^\]]*condition="tests_written=false"/);
    expect(dot).toMatch(/implementation_tester\s*->\s*commit_push\s*\[[^\]]*condition="test_result=pass"/);
    expect(dot).toMatch(/implementation_tester\s*->\s*done\s*\[[^\]]*condition="test_result=fail"/);
    expect(dot).toMatch(/commit_push\s*->\s*done/);
  });
});
