import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import type { Interviewer } from "../interviewer/index.js";

export class WaitHumanHandler implements NodeHandler {
  constructor(private interviewer: Interviewer) {}

  async execute(node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const labels = (meta["outgoingLabels"] as string[]) ?? [];
    const signal = meta["signal"] as AbortSignal | undefined;

    if (signal?.aborted) {
      return { status: "fail", failureReason: "Aborted before human prompt" };
    }

    const askPromise = this.interviewer.ask({
      type: "MULTIPLE_CHOICE",
      prompt: node.label ?? node.id,
      options: labels.length > 0 ? labels : ["continue"],
    });

    if (!signal) {
      const answer = await askPromise;
      return { status: "success", preferredLabel: answer.value };
    }

    const answer = await Promise.race([
      askPromise,
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    ]).catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw err;
    });

    if (answer === null) {
      return { status: "fail", failureReason: "Aborted during human prompt" };
    }
    return { status: "success", preferredLabel: answer.value };
  }
}
