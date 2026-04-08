import type { Graph } from "../types.js";

export function variableExpansionTransform(graph: Graph, vars: { project?: string }): Graph {
  const goal = graph.goal ?? "";
  const project = vars.project ?? "";

  const newNodes = new Map(
    [...graph.nodes.entries()].map(([id, node]) => {
      const n = { ...node };
      if (n.prompt) n.prompt = n.prompt.replace(/\$goal/g, goal).replace(/\$project/g, project);
      if (n.toolCommand) n.toolCommand = n.toolCommand.replace(/\$goal/g, goal).replace(/\$project/g, project);
      return [id, n];
    })
  );
  return { ...graph, nodes: newNodes };
}
