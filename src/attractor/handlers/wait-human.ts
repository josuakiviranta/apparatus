import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import type { Interviewer } from "../interviewer/index.js";
import { expandVariables, extractDefaults } from "../transforms/variable-expansion.js";
import { resolveGate } from "../../cli/lib/gate-registry.js";

export class WaitHumanHandler implements NodeHandler {
  constructor(private interviewer: Interviewer, private dotDir?: string) {}

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const labels = meta.outgoingLabels;
    const signal = meta.signal;

    if (signal?.aborted) {
      return { status: "fail", failureReason: "Aborted before human prompt" };
    }

    let prompt: string;
    let choices: string[];
    if (node.label) {
      prompt = expandVariables(node.label, ctx.values, extractDefaults(node));
      choices = labels.length > 0 ? labels : ["continue"];
    } else if (this.dotDir) {
      try {
        const gate = resolveGate(node.id, { dotDir: this.dotDir });
        prompt = expandVariables(gate.prompt, ctx.values, extractDefaults(node));
        choices = gate.choices;
      } catch (err) {
        return { status: "fail", failureReason: err instanceof Error ? err.message : String(err) };
      }
    } else {
      return { status: "fail", failureReason: `Gate "${node.id}" has no inline label and no dotDir to resolve sibling .md` };
    }

    const askPromise = this.interviewer.ask({
      type: "MULTIPLE_CHOICE",
      prompt,
      options: choices,
    });

    if (!signal) {
      const answer = await askPromise;
      return {
        status: "success",
        preferredLabel: answer.value,
        contextUpdates: { [`${node.id}.choice`]: answer.value, choice: answer.value },
      };
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
    return {
      status: "success",
      preferredLabel: answer.value,
      contextUpdates: { [`${node.id}.choice`]: answer.value, choice: answer.value },
    };
  }
}
