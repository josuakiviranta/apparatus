import { describe, it, expect } from "vitest";
import { classifyNode, isInteractive } from "../lib/classifyNode.js";
import type { Node } from "../../attractor/types.js";

function node(partial: Partial<Node>): Node {
  return { id: "x", ...partial };
}

describe("classifyNode", () => {
  it("returns 'interactive-agent' for agent nodes with interactive=true", () => {
    expect(classifyNode(node({ agent: "claude", interactive: true }))).toBe("interactive-agent");
  });

  it("returns 'interactive-agent' for agent nodes with interactive='true' (string form)", () => {
    expect(classifyNode(node({ agent: "claude", interactive: "true" }))).toBe("interactive-agent");
  });

  it("returns 'agent' for agent nodes without interactive flag", () => {
    expect(classifyNode(node({ agent: "claude" }))).toBe("agent");
    expect(classifyNode(node({ agent: "claude", interactive: false }))).toBe("agent");
  });

  it("returns 'tool' for explicit tool type", () => {
    expect(classifyNode(node({ type: "tool", toolCommand: "ls" }))).toBe("tool");
  });

  it("returns 'tool' for parallelogram-shaped nodes (SHAPE_TO_TYPE=tool)", () => {
    expect(classifyNode(node({ shape: "parallelogram" }))).toBe("tool");
  });

  it("returns 'wait-human' for wait-human nodes declared via node.type", () => {
    expect(classifyNode(node({ type: "wait-human" }))).toBe("wait-human");
  });

  it("returns 'wait-human' for hexagon-shaped nodes (resolveHandlerType returns 'wait.human')", () => {
    expect(classifyNode(node({ shape: "hexagon" }))).toBe("wait-human");
  });

  it("returns 'conditional' for diamond-shaped nodes", () => {
    expect(classifyNode(node({ shape: "diamond" }))).toBe("conditional");
  });

  it("returns 'marker' for start/exit/done markers", () => {
    expect(classifyNode(node({ id: "start", shape: "Mdiamond" }))).toBe("marker");
    expect(classifyNode(node({ id: "exit", shape: "Msquare" }))).toBe("marker");
    expect(classifyNode(node({ id: "done" }))).toBe("marker");
  });

  it("returns 'marker' for codergen fallback (unknown shape / no type / no agent)", () => {
    // shape "box" → SHAPE_TO_TYPE="codergen"; codergen is not a BlockKind so it collapses to marker
    expect(classifyNode(node({ shape: "box" }))).toBe("marker");
    // no hints at all → resolveHandlerType returns "codergen"
    expect(classifyNode(node({ id: "weird" }))).toBe("marker");
  });
});

describe("isInteractive", () => {
  it("is true only for interactive-agent", () => {
    expect(isInteractive(node({ agent: "claude", interactive: true }))).toBe(true);
    expect(isInteractive(node({ agent: "claude" }))).toBe(false);
    expect(isInteractive(node({ type: "tool" }))).toBe(false);
  });
});
