import { describe, it, expect } from "vitest";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";
import { readFileSync } from "fs";

const fixtureDir = join(
  new URL(".", import.meta.url).pathname,
  "fixtures/auto-inputs-good"
);

describe("validator — auto-inputs-good fixture round-trip", () => {
  it("emits 0 errors on the well-formed auto-inputs pipeline", () => {
    const dotSource = readFileSync(join(fixtureDir, "pipeline.dot"), "utf-8");
    const graph = parseDot(dotSource);
    const diags = validateGraph(graph, fixtureDir);
    const errors = diags.filter(d => d.severity === "error");
    if (errors.length > 0) {
      console.error("Unexpected errors:", JSON.stringify(errors, null, 2));
    }
    expect(errors.length).toBe(0);
  });
});
