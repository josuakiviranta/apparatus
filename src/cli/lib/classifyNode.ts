import type { Node } from "../../attractor/types.js";
import { resolveHandlerType } from "../../attractor/core/graph.js";

export type BlockKind =
  | "agent"
  | "interactive-agent"
  | "tool"
  | "store"
  | "wait-human"
  | "conditional"
  | "marker";

/**
 * Classifies a pipeline node into a BlockKind used by the renderer.
 * Mirrors resolveHandlerType() for handler routing, then collapses
 * start/exit/done markers into "marker" and splits agent by interactivity.
 */
export function classifyNode(node: Node): BlockKind {
  // Markers first — start/exit/done produce no agent output
  if (
    node.shape === "Mdiamond" ||
    node.shape === "Msquare" ||
    node.id === "start" ||
    node.id === "Start" ||
    node.id === "exit" ||
    node.id === "end" ||
    node.id === "done"
  ) {
    return "marker";
  }

  const t = resolveHandlerType(node);

  if (t === "agent") {
    const interactive = node.interactive === true || node.interactive === "true";
    return interactive ? "interactive-agent" : "agent";
  }
  if (t === "tool") return "tool";
  if (t === "store") return "store";
  // Accept both the hyphenated form (node.type="wait-human") and the dotted form
  // (SHAPE_TO_TYPE["hexagon"] = "wait.human") that resolveHandlerType can produce.
  if (t === "wait-human" || t === "wait.human") return "wait-human";
  if (t === "conditional") return "conditional";

  // Anything else (codergen, parallel, start, exit, ralph.*, stack.*, etc.) is
  // treated as a marker — no trace path, no streaming body, just a structural
  // line in the rendered output.
  return "marker";
}

export function isInteractive(node: Node): boolean {
  return classifyNode(node) === "interactive-agent";
}
