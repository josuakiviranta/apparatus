import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";
import { scanUndeclaredCallerVars } from "../../attractor/transforms/variable-expansion.js";

const REPO_ROOT = resolve(__dirname, "../../..");
const BUNDLED_PIPELINES_DIR = join(REPO_ROOT, "src", "cli", "pipelines");

function bundledPipelines(): { name: string; dotPath: string }[] {
  return readdirSync(BUNDLED_PIPELINES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      dotPath: join(BUNDLED_PIPELINES_DIR, d.name, "pipeline.dot"),
    }))
    .filter((p) => existsSync(p.dotPath));
}

describe("bundled pipelines — runnable through `apparat pipeline run` with only declared inputs", () => {
  const pipelines = bundledPipelines();

  it("discovered at least one bundled pipeline", () => {
    expect(pipelines.length).toBeGreaterThan(0);
  });

  for (const { name, dotPath } of pipelines) {
    describe(`pipeline: ${name}`, () => {
      it("validateGraph emits zero error-level diagnostics", () => {
        const graph = parseDot(readFileSync(dotPath, "utf-8"));
        const diags = validateGraph(graph, dirname(dotPath));
        const errors = diags.filter((d) => d.severity === "error");
        expect(errors).toEqual([]);
      });

      it("preflight surfaces zero undeclared references when caller supplies only declared inputs", () => {
        const graph = parseDot(readFileSync(dotPath, "utf-8"));
        const variables: Record<string, string> = {};
        for (const decl of graph.inputs ?? []) {
          variables[decl] = "";
        }
        const preflight = scanUndeclaredCallerVars(graph, variables);
        const undeclaredNames = preflight.undeclared.map((r) => r.name);
        expect(
          undeclaredNames,
          `Pipeline "${name}" references variables not declared in inputs= and not produced by any node: ${undeclaredNames.join(", ")}. ` +
          `This is the wrapper-stuffing class of bug — the pipeline cannot run via \`apparat pipeline run\` with only its declared inputs.`,
        ).toEqual([]);
      });
    });
  }
});
