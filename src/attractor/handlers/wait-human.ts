import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import type { Interviewer } from "../interviewer/index.js";

export class WaitHumanHandler implements NodeHandler {
  constructor(private interviewer: Interviewer) {}

  async execute(node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const labels = (meta["outgoingLabels"] as string[]) ?? [];
    const answer = await this.interviewer.ask({
      type: "MULTIPLE_CHOICE",
      prompt: node.label ?? node.id,
      options: labels.length > 0 ? labels : ["continue"],
    });
    return { status: "success", preferredLabel: answer.value };
  }
}
