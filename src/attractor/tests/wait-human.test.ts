import { describe, it, expect } from "vitest";
import { WaitHumanHandler } from "../handlers/wait-human.js";
import type { Interviewer, Question, Answer } from "../interviewer/index.js";
import type { Node, PipelineContext } from "../types.js";

describe("WaitHumanHandler — label variable expansion (Bug B.1)", () => {
  it("expands $var references in the label before showing to the user", async () => {
    const captured: Question[] = [];
    const interviewer: Interviewer = {
      ask: async (q: Question): Promise<Answer> => {
        captured.push(q);
        return { value: "continue" };
      },
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = {
      id: "gate",
      label: "Review $chat.output before continuing",
    };
    const ctx: PipelineContext = { values: { "chat.output": "the proposal text" } };
    const meta = { outgoingLabels: ["continue"] };

    await handler.execute(node, ctx, meta);

    expect(captured[0].prompt).toBe("Review the proposal text before continuing");
  });

  it("leaves unreferenced labels unchanged", async () => {
    const captured: Question[] = [];
    const interviewer: Interviewer = {
      ask: async (q: Question): Promise<Answer> => {
        captured.push(q);
        return { value: "continue" };
      },
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = { id: "gate", label: "Just continue" };
    const ctx: PipelineContext = { values: {} };
    await handler.execute(node, ctx, { outgoingLabels: ["continue"] });
    expect(captured[0].prompt).toBe("Just continue");
  });

  it("falls back to node.id when label is undefined", async () => {
    const captured: Question[] = [];
    const interviewer: Interviewer = {
      ask: async (q: Question): Promise<Answer> => {
        captured.push(q);
        return { value: "continue" };
      },
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = { id: "gate" };
    const ctx: PipelineContext = { values: {} };
    await handler.execute(node, ctx, { outgoingLabels: ["continue"] });
    expect(captured[0].prompt).toBe("gate");
  });
});
