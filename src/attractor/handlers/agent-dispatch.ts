import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class AgentHandlerDispatch implements NodeHandler {
  constructor(
    private readonly interactive: NodeHandler,
    private readonly looping: NodeHandler,
  ) {}

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    // DOT attributes parse as strings; coerce explicitly to boolean.
    const isInteractive = node.interactive === true || node.interactive === "true";
    return isInteractive
      ? this.interactive.execute(node, ctx, meta)
      : this.looping.execute(node, ctx, meta);
  }
}
