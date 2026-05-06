import type { Graph, Node } from "../types.js";
import { parseDotV2 } from "./graph-ast.js";

export function parseDot(src: string): Graph {
  return parseDotV2(src);
}

export const KNOWN_TYPES = new Set([
  "codergen", "tool", "wait.human", "conditional",
  "start", "exit", "store",
  "apparat.implement", "apparat.meditate",
  "agent", "stack.manager_loop",
]);

// Types that pass validation but are not yet implemented — emit errors
export const UNIMPLEMENTED_TYPES = new Set([
  "stack.manager_loop",              // no handler registered
]);

export const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start", Msquare: "exit", box: "codergen",
  hexagon: "wait.human", diamond: "conditional",
  parallelogram: "tool", house: "stack.manager_loop",
  circle: "apparat.implement", octagon: "apparat.meditate",
  cylinder: "store",
};

export function resolveHandlerType(node: Node): string {
  if (node.agent) return "agent";
  if (node.type) return node.type;
  if (node.shape && SHAPE_TO_TYPE[node.shape]) return SHAPE_TO_TYPE[node.shape];
  return "codergen";
}

/**
 * Canonical predicate for the "interactive agent" runtime rule.
 *
 * DOT attributes parse as strings; the schema (src/attractor/core/schemas.ts:26)
 * accepts boolean, "true", or "false". This predicate is the single reader of
 * that union — call sites import it instead of re-coding the coercion.
 *
 * @returns true iff node.interactive is boolean true or string "true".
 */
export function isInteractiveAgent(node: Node): boolean {
  return node.interactive === true || node.interactive === "true";
}
