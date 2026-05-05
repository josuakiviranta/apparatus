import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";

const REPO_ROOT = resolve(__dirname, "../../..");

describe(".ralph/scenarios/chat-only/ — chunk-4 per-folder migration", () => {
  it("pipeline.dot exists at <repo>/.ralph/scenarios/chat-only/pipeline.dot", () => {
    const expected = join(REPO_ROOT, ".ralph", "scenarios", "chat-only", "pipeline.dot");
    expect(existsSync(expected)).toBe(true);
  });

  it("ships chat.md alongside pipeline.dot for project-local agent resolution", () => {
    const agentPath = join(REPO_ROOT, ".ralph", "scenarios", "chat-only", "chat.md");
    expect(existsSync(agentPath)).toBe(true);
    expect(readFileSync(agentPath, "utf-8")).toContain("name: chat");
  });

  it("validateGraph emits zero error-level diagnostics for the migrated pipeline", () => {
    const dotPath = join(REPO_ROOT, ".ralph", "scenarios", "chat-only", "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const diags = validateGraph(graph, dirname(dotPath));
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });
});
