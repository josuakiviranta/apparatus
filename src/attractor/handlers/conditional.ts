import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class ConditionalHandler implements NodeHandler {
  async execute(_node: Node, _ctx: PipelineContext, _meta: HandlerExecutionContext): Promise<Outcome> {
    return { status: "success" };
  }
}
