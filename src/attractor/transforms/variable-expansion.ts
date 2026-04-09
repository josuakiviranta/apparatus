import type { Graph } from "../types.js";

export function variableExpansionTransform(graph: Graph, vars: { project?: string; context?: Record<string, string> }): Graph {
  const goal = graph.goal ?? "";
  const project = vars.project ?? "";
  const ctx = vars.context ?? {};

  function expand(s: string): string {
    s = s.replace(/\$goal/g, goal).replace(/\$project/g, project);
    // Expand all context keys: $key.name → context["key.name"]
    s = s.replace(/\$([a-zA-Z_][\w.]*)/g, (match, key) => {
      if (key === "goal" || key === "project") return match; // already handled
      return ctx[key] ?? match;
    });
    return s;
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
