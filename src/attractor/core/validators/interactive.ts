import type { Node } from "../../types.js";
import type { ValidationContext } from "./context.js";
import { tryResolveAgent } from "./agent-resolver.js";
import { isInteractiveAgent } from "../graph.js";

export function checkLoopRequiresDoneField(ctx: ValidationContext, node: Node): void {
  if (!node.agent) return;
  if (isInteractiveAgent(node)) return;

  const agentConfig = tryResolveAgent(node, ctx.dotDir);
  if (!agentConfig) return;
  if (agentConfig.loop !== true) return;

  const outputs = agentConfig.outputs ?? {};
  const doneShape = (outputs as Record<string, unknown>).done;
  const ok =
    doneShape === "boolean" ||
    (typeof doneShape === "object" && doneShape !== null &&
     (doneShape as { type?: string }).type === "boolean");

  if (!ok) {
    ctx.diags.push({
      rule: "loop_missing_done_field",
      severity: "error",
      message: `Agent "${node.agent}" at node "${node.id}" declares loop:true but its outputs: lacks a done:boolean field. Add 'done: boolean' to the agent's outputs frontmatter.`,
      location: node.sourceLocation,
    });
  }
}

export function checkInteractiveWithOutputs(ctx: ValidationContext, node: Node): void {
  if (!node.agent) return;
  if (!isInteractiveAgent(node)) return;
  const agentConfig = tryResolveAgent(node, ctx.dotDir);
  if (!agentConfig) return;
  const hasOutputs = !!(agentConfig.outputs && Object.keys(agentConfig.outputs).length > 0);
  if (!hasOutputs) return;
  ctx.diags.push({
    rule: "interactive_with_outputs_forbidden",
    severity: "error",
    message: `Node "${node.id}" sets interactive=true but agent "${node.agent}" declares outputs:. Remove the outputs: block from the agent frontmatter, or remove interactive=true from the node.`,
    location: node.sourceLocation,
  });
}

export function checkInteractiveWithLoop(ctx: ValidationContext, node: Node): void {
  if (!node.agent) return;
  if (!isInteractiveAgent(node)) return;

  // Node-level loop signals
  const nodeLoopOn = node.loop === true || node.loop === "true";
  const nodeMaxRaw = node.maxIterations;
  const nodeMaxParsed =
    typeof nodeMaxRaw === "string" ? parseInt(nodeMaxRaw, 10)
    : typeof nodeMaxRaw === "number" ? nodeMaxRaw
    : undefined;
  const nodeMaxLoops = nodeMaxParsed != null && !isNaN(nodeMaxParsed) && nodeMaxParsed > 1;

  // Agent-level loop signals
  const agentConfig = tryResolveAgent(node, ctx.dotDir);
  const agentLoopOn = agentConfig?.loop === true;
  const agentMax = agentConfig?.maxIterations;
  const agentMaxLoops = typeof agentMax === "number" && agentMax > 1;

  if (!(nodeLoopOn || nodeMaxLoops || agentLoopOn || agentMaxLoops)) return;

  ctx.diags.push({
    rule: "interactive_with_loop_forbidden",
    severity: "error",
    message: `Node "${node.id}" sets interactive=true with looping (loop=true / maxIterations>1). Interactive sessions cannot iterate — remove loop=true / maxIterations from the node or agent, or remove interactive=true.`,
    location: node.sourceLocation,
  });
}
