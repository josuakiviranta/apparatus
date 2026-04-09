import type { Graph } from "../types.js";

/**
 * Expand $key references in a string against a key-value context.
 * Skips $goal and $project (handled by the graph-level transform).
 */
export function expandVariables(s: string, ctx: Record<string, string>): string {
  return s.replace(/\$([a-zA-Z_][\w.]*)/g, (match, key) => {
    if (key === "goal" || key === "project") return match;
    return ctx[key] ?? match;
  });
}

export function variableExpansionTransform(graph: Graph, vars: { project?: string; context?: Record<string, string> }): Graph {
  const goal = graph.goal ?? "";
  const project = vars.project ?? "";
  const ctx = vars.context ?? {};

  function expand(s: string): string {
    s = s.replace(/\$goal/g, goal).replace(/\$project/g, project);
    return expandVariables(s, ctx);
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
