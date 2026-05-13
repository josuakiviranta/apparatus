import type { Node } from "../../types.js";
import type { ValidationContext } from "./context.js";
import { tryResolveAgent } from "./agent-resolver.js";

export function checkModelRequired(ctx: ValidationContext, node: Node): void {
  if (!node.agent) return;
  const agentConfig = tryResolveAgent(node, ctx.dotDir);
  if (!agentConfig) return; // unresolved agent — separate rule (agent_missing) handles
  const m = (agentConfig as { model?: unknown }).model;
  if (m === "opus" || m === "sonnet" || m === "haiku") return;
  ctx.diags.push({
    rule: "model_required",
    severity: "error",
    message: `Agent "${node.agent}" at node "${node.id}" is missing required model: field. Add 'model: opus|sonnet|haiku' to the agent frontmatter (got: ${m === undefined ? "undefined" : JSON.stringify(m)}).`,
    location: node.sourceLocation,
  });
}
