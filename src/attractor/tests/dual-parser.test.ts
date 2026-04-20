import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { parseDot } from "../core/graph.js";
import { parseDotV2 } from "../core/graph-ast.js";
import type { Graph, Node } from "../types.js";

// This test was originally a dual-run check (parseDot ≡ parseDotV2) during
// the migration. Now that parseDot delegates to parseDotV2, it serves as a
// fixture snapshot: every .dot in pipelines/ must continue to parse with the
// same Graph shape. If this test fails after a parser change, a pipeline's
// semantics changed silently — review the diff carefully.

function collectPipelines(): string[] {
  const out: string[] = [];
  const roots = ["pipelines", "pipelines/smoke"];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    for (const name of readdirSync(r)) {
      const p = join(r, name);
      if (name.endsWith(".dot") && statSync(p).isFile()) out.push(p);
    }
  }
  return out;
}

function stripSourceLine(n: Node): Node {
  const { sourceLine, ...rest } = n;
  return rest as Node;
}

function graphEquiv(a: Graph, b: Graph) {
  expect(b.name).toBe(a.name);
  expect(b.goal).toEqual(a.goal);
  expect(b.label).toEqual(a.label);
  expect(b.modelStylesheet).toEqual(a.modelStylesheet);
  expect(b.inputs).toEqual(a.inputs);
  expect(b.defaultMaxRetries).toEqual(a.defaultMaxRetries);
  expect(b.defaultFidelity).toEqual(a.defaultFidelity);
  expect(b.maxParallel).toEqual(a.maxParallel);
  expect(b.retryTarget).toEqual(a.retryTarget);
  expect(b.fallbackRetryTarget).toEqual(a.fallbackRetryTarget);
  expect(b.headlessSafe).toEqual(a.headlessSafe);

  const aKeys = [...a.nodes.keys()].sort();
  const bKeys = [...b.nodes.keys()].sort();
  expect(bKeys).toEqual(aKeys);
  for (const k of aKeys) {
    expect(stripSourceLine(b.nodes.get(k)!))
      .toEqual(stripSourceLine(a.nodes.get(k)!));
  }

  expect(b.edges.length).toBe(a.edges.length);
  for (let i = 0; i < a.edges.length; i++) {
    expect(b.edges[i]).toEqual(a.edges[i]);
  }
}

describe("parseDot fixture regression (AST parser)", () => {
  const files = collectPipelines();
  it.each(files)("%s produces equivalent Graph", (file) => {
    const src = readFileSync(file, "utf8");
    const g1 = parseDot(src);
    const g2 = parseDotV2(src);
    graphEquiv(g1, g2);
  });

  it("parseDotV2 records sourceLine on every node", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const g = parseDotV2(src);
      for (const [id, n] of g.nodes) {
        expect(n.sourceLine, `${file}: node ${id} missing sourceLine`)
          .toBeGreaterThan(0);
      }
    }
  });
});
