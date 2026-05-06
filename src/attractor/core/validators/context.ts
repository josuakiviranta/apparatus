import type { Graph, Node, Diagnostic } from "../../types.js";
import { buildForwardAdj, toCamel } from "../dot-common.js";
import { resolveHandlerType } from "../graph.js";
import { loadAgent } from "../../../cli/lib/agent-loader.js";
import { SYSTEM_INJECTED_VARS } from "../../handlers/agent-prep.js";

export const RESERVED_VARS = new Set<string>(["goal", "project", "run_id"]);
export const SYSTEM_VARS = new Set<string>(SYSTEM_INJECTED_VARS);

export interface GraphTraversal {
  hasDefault(node: Node, varName: string): boolean;
  reachable(source: string, target: string, excluded: Set<string>): boolean;
  findQualifiedProducer(consumerId: string): string | undefined;
}

export interface ValidationContext {
  graph: Graph;
  dotDir: string | undefined;
  nodeProduces: Map<string, Set<string>>;
  traversal: GraphTraversal;
  callerInputs: Set<string>;
  diags: Diagnostic[];
}

const TYPE_PRODUCES: Record<string, string[]> = {
  "tool": ["tool.output"],
  "store": ["store.path"],
  "wait.human": ["chat.output", "choice"],
};

export function createGraphTraversal(
  graph: Graph,
  adj: Map<string, string[]>,
  resolveHandler: (node: Node) => string,
): GraphTraversal {
  const { nodes } = graph;

  function hasDefault(node: Node, varName: string): boolean {
    const key = toCamel("default_" + varName);
    return node[key] !== undefined;
  }

  function reachable(source: string, target: string, excluded: Set<string>): boolean {
    if (source === target) return true;
    const visited = new Set<string>();
    const queue = [source];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (cur === target) return true;
      for (const next of (adj.get(cur) ?? [])) {
        if (!excluded.has(next)) queue.push(next);
      }
    }
    return false;
  }

  function findQualifiedProducer(consumerId: string): string | undefined {
    for (const [id, node] of nodes) {
      if (id === consumerId) continue;
      if (resolveHandler(node) !== "tool") continue;
      if (!node.producesFromStdout) continue;
      if (!reachable(id, consumerId, new Set())) continue;
      return id;
    }
    return undefined;
  }

  return { hasDefault, reachable, findQualifiedProducer };
}

function buildNodeProduces(
  graph: Graph,
  dotDir: string | undefined,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [id, node] of graph.nodes) {
    const produced = new Set<string>();
    const handlerType = resolveHandlerType(node);
    if (TYPE_PRODUCES[handlerType]) {
      for (const v of TYPE_PRODUCES[handlerType]) produced.add(v);
    }
    if (handlerType === "wait.human") {
      produced.add(`${id}.choice`);
    }
    if (node.interactive) produced.add("chat.output");
    if (typeof node.produces === "string") {
      for (const v of (node.produces as string).split(",").map(s => s.trim()).filter(Boolean)) {
        produced.add(v);
      }
    }
    if (node.agent && dotDir) {
      try {
        const agentConfig = loadAgent(node.agent as string, dotDir);
        if (agentConfig.outputs) {
          for (const key of Object.keys(agentConfig.outputs)) {
            produced.add(key);
          }
        }
      } catch {
        // Agent file unresolvable; do not crash the validator.
      }
    }
    out.set(id, produced);
  }
  return out;
}

export function createValidationContext(
  graph: Graph,
  dotDir: string | undefined,
): ValidationContext {
  const adj = buildForwardAdj(graph);
  const traversal = createGraphTraversal(graph, adj, resolveHandlerType);
  const callerInputs = new Set<string>(graph.inputs ?? []);
  const nodeProduces = buildNodeProduces(graph, dotDir);
  return { graph, dotDir, nodeProduces, traversal, callerInputs, diags: [] };
}
