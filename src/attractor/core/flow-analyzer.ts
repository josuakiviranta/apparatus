import type { Graph } from "../types.js";
import { buildForwardAdj } from "./dot-common.js";

/**
 * Compute the set of variable names in scope at each node.
 *
 * "In scope at N" means: there is some declaration on every path from the start
 * node to N that makes the variable available. This is the intersection
 * across predecessors of (predecessor's in-scope ∪ predecessor's produces).
 *
 * Caller inputs (graph.inputs) are in scope from the start node onward.
 *
 * default_<key>= on a node (normalized to camelCase defaultKey at parse time)
 * adds that key to its in-scope set unconditionally, regardless of whether
 * incoming branches produce it.
 *
 * Cycles are handled by computing a forward-only topological order; back-edges
 * do not contribute on the first pass. Retry-loop branches (e.g. implement →
 * implement on agent.success=false) thus see only their forward-path scope.
 */
export function computeVarsInScope(
  graph: Graph,
  nodeProduces: Map<string, Set<string>>,
): Map<string, Set<string>> {
  return computeScope(graph, nodeProduces, "intersect");
}

/**
 * Companion to {@link computeVarsInScope}: returns the set of vars that are
 * available on AT LEAST ONE path to each node (predecessor union semantics).
 *
 * Used by `branch_incomplete_input` to distinguish "no producer anywhere"
 * (→ `missing_input_producer`) from "some predecessor has it but not all"
 * (→ `branch_incomplete_input`).
 */
export function computeVarsInAnyScope(
  graph: Graph,
  nodeProduces: Map<string, Set<string>>,
): Map<string, Set<string>> {
  return computeScope(graph, nodeProduces, "union");
}

function computeScope(
  graph: Graph,
  nodeProduces: Map<string, Set<string>>,
  combine: "intersect" | "union",
): Map<string, Set<string>> {
  const { nodes, edges } = graph;
  const callerInputs = new Set<string>(
    Array.isArray(graph.inputs) ? graph.inputs : [],
  );

  // Build forward adjacency via the shared primitive (dot-common.ts).
  const fwd = buildForwardAdj(graph);
  // Reverse adjacency stays inline — only consumer in the repo (design §7.3).
  const rev = new Map<string, string[]>();
  for (const id of nodes.keys()) rev.set(id, []);
  for (const e of edges) {
    if (rev.has(e.from) && rev.has(e.to)) rev.get(e.to)!.push(e.from);
  }

  // Find start node: shape=Mdiamond or id="start"
  const startId = [...nodes.values()].find(
    n => n.shape === "Mdiamond" || n.id === "start",
  )?.id;

  // Kahn's topological sort (handles cycles by ignoring back-edges)
  const inDegree = new Map<string, number>();
  for (const [id, preds] of rev) inDegree.set(id, preds.length);

  const queue: string[] = startId ? [startId] : [];
  const topo: string[] = [];
  const visitedIn = new Map(inDegree);

  // Force start node to be processed first regardless of in-degree
  if (startId !== undefined) {
    visitedIn.set(startId, 0);
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    topo.push(cur);
    for (const next of fwd.get(cur) ?? []) {
      const d = (visitedIn.get(next) ?? 0) - 1;
      visitedIn.set(next, d);
      if (d <= 0) queue.push(next);
    }
  }

  // Append any nodes not reached (disconnected subgraphs)
  for (const id of nodes.keys()) {
    if (!topo.includes(id)) topo.push(id);
  }

  // Compute per-node scope in topological order
  const scope = new Map<string, Set<string>>();

  for (const id of topo) {
    const node = nodes.get(id);
    if (!node) continue;

    let nodeScope: Set<string>;

    if (id === startId) {
      nodeScope = new Set(callerInputs);
    } else {
      // Only consider predecessors already processed (avoids back-edge contribution)
      const visitedPreds = (rev.get(id) ?? []).filter(p => scope.has(p));
      if (visitedPreds.length === 0) {
        nodeScope = new Set();
      } else if (combine === "intersect") {
        let intersected: Set<string> | null = null;
        for (const pred of visitedPreds) {
          const predUnion = new Set([
            ...scope.get(pred)!,
            ...(nodeProduces.get(pred) ?? []),
          ]);
          if (intersected === null) {
            intersected = new Set(predUnion);
          } else {
            for (const v of [...intersected]) {
              if (!predUnion.has(v)) intersected.delete(v);
            }
          }
        }
        nodeScope = intersected ?? new Set();
      } else {
        // union: any-path semantics
        const merged = new Set<string>();
        for (const pred of visitedPreds) {
          for (const v of scope.get(pred)!) merged.add(v);
          for (const v of (nodeProduces.get(pred) ?? [])) merged.add(v);
        }
        nodeScope = merged;
      }
    }

    // default_<varname> in DOT is normalized to camelCase defaultVarname at parse time
    // (toCamel: `_x` → `X`). Recover the original snake_case var name by stripping the
    // "default" prefix and inverting each capital letter back to `_<lower>`.
    // e.g. defaultFoo → "foo"; defaultTestResult → "test_result"
    for (const attrKey of Object.keys(node)) {
      if (attrKey.startsWith("default") && attrKey.length > 7) {
        const suffix = attrKey.slice(7);
        const varName =
          suffix.charAt(0).toLowerCase() +
          suffix.slice(1).replace(/[A-Z]/g, c => "_" + c.toLowerCase());
        if (varName.length > 0) {
          nodeScope.add(varName);
        }
      }
    }

    scope.set(id, nodeScope);
  }

  return scope;
}
