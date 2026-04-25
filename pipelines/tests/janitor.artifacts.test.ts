import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDot } from "../../src/attractor/core/graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOT_PATH = resolve(__dirname, "../janitor.dot");

describe("pipelines/janitor.dot — shape contract", () => {
  const dot = readFileSync(DOT_PATH, "utf8");
  const graph = parseDot(dot);

  it("is headless-safe so the heartbeat daemon can run it", () => {
    expect(graph.headlessSafe).toBe(true);
  });

  it("declares exactly the project input", () => {
    expect(graph.inputs).toEqual(["project"]);
  });

  it("contains exactly one agent node, of agent=janitor", () => {
    const agentNodes = [...graph.nodes.values()].filter(
      (n: any) => n.agent !== undefined,
    );
    expect(agentNodes).toHaveLength(1);
    expect((agentNodes[0] as any).agent).toBe("janitor");
  });

  it("references $project in the janitor prompt", () => {
    const janitor = [...graph.nodes.values()].find(
      (n: any) => n.agent === "janitor",
    ) as any;
    expect(janitor.prompt).toMatch(/\$project/);
  });

  it("wires start -> janitor -> done with no other nodes", () => {
    const ids = [...graph.nodes.keys()].sort();
    expect(ids).toEqual(["done", "janitor", "start"]);
  });
});
