import type { Node } from "../../types.js";
import type { ValidationContext } from "./context.js";
import { parseConditionClauses } from "../conditions.js";

const isStart = (n: Node): boolean => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start";
const isExit  = (n: Node): boolean => n.shape === "Msquare"  || n.id === "exit"  || n.id === "end";

export function run(ctx: ValidationContext): void {
  checkStartExitCount(ctx);
  checkReachability(ctx);
  checkStartNoIncoming(ctx);
  checkExitNoOutgoing(ctx);
  checkReachesExit(ctx);
  checkEdgeEndpoints(ctx);
  checkConditionSyntax(ctx);
}

function checkStartExitCount(ctx: ValidationContext): void {
  const { nodes, edges } = ctx.graph;
  const diags = ctx.diags;
  const startNodes = [...nodes.values()].filter(isStart);
  const exitNodes  = [...nodes.values()].filter(isExit);

  if (startNodes.length !== 1) diags.push({ rule: "start_node", severity: "error", message: `Expected exactly 1 start node, found ${startNodes.length}` });
  if (exitNodes.length !== 1)  diags.push({ rule: "terminal_node", severity: "error", message: `Expected exactly 1 exit node, found ${exitNodes.length}` });
}

function checkReachability(ctx: ValidationContext): void {
  const { nodes, edges } = ctx.graph;
  const diags = ctx.diags;
  const startNodes = [...nodes.values()].filter(isStart);

  // Reachability BFS from start
  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const queue = [startNodes[0].id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of edges.filter(e => e.from === cur)) queue.push(e.to);
    }
    for (const id of nodes.keys()) {
      if (!reachable.has(id)) diags.push({ rule: "reachability", severity: "error", message: `Node "${id}" is unreachable from start`, location: nodes.get(id)?.sourceLocation });
    }
  }
}

function checkStartNoIncoming(ctx: ValidationContext): void {
  const { nodes, edges } = ctx.graph;
  const diags = ctx.diags;
  const startNodes = [...nodes.values()].filter(isStart);

  if (startNodes.length === 1) {
    // start has no incoming
    if (edges.some(e => e.to === startNodes[0].id)) {
      diags.push({ rule: "start_no_incoming", severity: "error", message: "Start node must not have incoming edges", location: startNodes[0].sourceLocation });
    }
  }
}

function checkExitNoOutgoing(ctx: ValidationContext): void {
  const { nodes, edges } = ctx.graph;
  const diags = ctx.diags;
  const exitNodes  = [...nodes.values()].filter(isExit);

  // exit has no outgoing
  if (exitNodes.length === 1 && edges.some(e => e.from === exitNodes[0].id)) {
    diags.push({ rule: "exit_no_outgoing", severity: "error", message: "Exit node must not have outgoing edges", location: exitNodes[0].sourceLocation });
  }
}

function checkReachesExit(ctx: ValidationContext): void {
  const { nodes, edges } = ctx.graph;
  const diags = ctx.diags;
  const exitNodes  = [...nodes.values()].filter(isExit);

  // Reverse-BFS from exit: every non-exit node must be able to reach the exit.
  // Catches dead-end authoring bugs (e.g. a gate branch points at a node with
  // no outgoing edges) that forward-reachability alone cannot see.
  if (exitNodes.length === 1) {
    const exitId = exitNodes[0].id;
    const reverseAdj = new Map<string, string[]>();
    for (const id of nodes.keys()) reverseAdj.set(id, []);
    for (const e of edges) {
      if (reverseAdj.has(e.to)) reverseAdj.get(e.to)!.push(e.from);
    }
    const reachesExit = new Set<string>();
    const queue = [exitId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reachesExit.has(cur)) continue;
      reachesExit.add(cur);
      for (const pred of (reverseAdj.get(cur) ?? [])) queue.push(pred);
    }
    for (const [id, node] of nodes) {
      if (isExit(node)) continue;
      if (!reachesExit.has(id)) {
        diags.push({
          rule: "reaches_exit",
          severity: "error",
          message: `Node "${id}" has no path to the exit node`,
          location: node.sourceLocation,
        });
      }
    }
  }
}

function checkEdgeEndpoints(ctx: ValidationContext): void {
  const { nodes, edges } = ctx.graph;
  const diags = ctx.diags;

  // Edge targets exist
  for (const e of edges) {
    if (!nodes.has(e.to)) diags.push({ rule: "edge_target_exists", severity: "error", message: `Edge target "${e.to}" not declared`, location: e.sourceLocation });
    if (!nodes.has(e.from)) diags.push({ rule: "edge_source_exists", severity: "error", message: `Edge source "${e.from}" not declared`, location: e.sourceLocation });
  }
}

function checkConditionSyntax(ctx: ValidationContext): void {
  const { nodes, edges } = ctx.graph;
  const diags = ctx.diags;

  // Condition syntax (basic: only allow key=value and key!=value with &&)
  for (const e of edges) {
    if (e.condition) {
      const valid = /^[\w.'= !&\s]+$/.test(e.condition) && !/==|=>|<=/.test(e.condition);
      if (!valid) diags.push({ rule: "condition_syntax", severity: "error", message: `Invalid condition syntax: "${e.condition}"`, location: e.sourceLocation });
    }
  }
}
