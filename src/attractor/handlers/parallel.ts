import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class ParallelHandler implements NodeHandler {
  async execute(_node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const branchOutcomes = (meta["branchOutcomes"] as Record<string, Outcome>) ?? {};
    return {
      status: "success",
      contextUpdates: { "parallel.results": JSON.stringify(Object.values(branchOutcomes)) },
    };
  }
}

export class FanInHandler implements NodeHandler {
  async execute(_node: Node, ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    const raw = ctx.values["parallel.results"];
    const results: Outcome[] = raw ? JSON.parse(raw) : [];
    const allSucceeded = results.every(r => r.status === "success");
    const anySucceeded = results.some(r => r.status === "success");
    const status = allSucceeded ? "success" : anySucceeded ? "partial_success" : "fail";
    return { status };
  }
}
