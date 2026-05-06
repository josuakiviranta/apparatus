import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { isInteractiveAgent } from "../core/graph.js";

export class AgentHandlerDispatch implements NodeHandler {
  constructor(
    private readonly interactive: NodeHandler,
    private readonly looping: NodeHandler,
  ) {}

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    return isInteractiveAgent(node)
      ? this.interactive.execute(node, ctx, meta)
      : this.looping.execute(node, ctx, meta);
  }
}
