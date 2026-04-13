import type { Graph } from "../types.js";

export class UndefinedVariableError extends Error {
  constructor(public readonly variableName: string) {
    super(`Undefined variable $${variableName}`);
    this.name = "UndefinedVariableError";
  }
}

/**
 * Expand $key references in a string against a key-value context.
 * Skips $goal and $project (handled by the graph-level transform).
 * Throws UndefinedVariableError if a variable is not in ctx or defaults.
 */
export function expandVariables(
  s: string,
  ctx: Record<string, unknown>,
  defaults?: Record<string, string>,
): string {
  return s.replace(/\$([a-zA-Z_][\w.]*)/g, (match, key) => {
    if (key === "goal" || key === "project") return match;
    const v = ctx[key];
    if (v === undefined) {
      const fallback = defaults?.[key];
      if (fallback !== undefined) return fallback;
      throw new UndefinedVariableError(key);
    }
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
    return JSON.stringify(v);
  });
}

export function variableExpansionTransform(graph: Graph, vars: { project?: string; context?: Record<string, unknown> }): Graph {
  const goal = graph.goal ?? "";
  const project = vars.project ?? "";
  const ctx = vars.context ?? {};

  function expand(s: string): string {
    const replaced = s.replace(/\$goal/g, goal).replace(/\$project/g, project);
    try {
      return expandVariables(replaced, ctx);
    } catch (e) {
      if (e instanceof UndefinedVariableError) return replaced;
      throw e;
    }
  }

  const newNodes = new Map(
    [...graph.nodes.entries()].map(([id, node]) => {
      const n = { ...node };
      if (n.prompt) n.prompt = expand(n.prompt);
      if (n.toolCommand) n.toolCommand = expand(n.toolCommand);
      return [id, n];
    })
  );
  return { ...graph, nodes: newNodes };
}
