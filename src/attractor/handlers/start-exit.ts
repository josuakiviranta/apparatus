import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class StartHandler implements NodeHandler {
  async execute(_node: Node, _ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    return { status: "success" };
  }
}

export class ExitHandler implements NodeHandler {
  async execute(_node: Node, _ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    return { status: "success" };
  }
}
