import { describe, it, expect, vi } from "vitest";
import { InkInterviewer } from "../interviewer/ink.js";
import type { NodeEvent } from "../../cli/lib/pipelineEvents.js";

function makeInterviewer() {
  const emitted: NodeEvent[] = [];
  const emit = (e: NodeEvent) => emitted.push(e);
  const interviewer = new InkInterviewer(emit);
  return { interviewer, emitted };
}

describe("InkInterviewer", () => {
  it("emits gate-ready with the provided options", async () => {
    const { interviewer, emitted } = makeInterviewer();
    // don't await — the promise is pending until onChoose is called
    const promise = interviewer.ask({
      type: "MULTIPLE_CHOICE",
      prompt: "Proceed?",
      options: ["Approve", "Decline"],
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].kind).toBe("gate-ready");
    if (emitted[0].kind === "gate-ready") {
      expect(emitted[0].options).toEqual(["Approve", "Decline"]);
    }

    // resolve so vitest doesn't hang
    if (emitted[0].kind === "gate-ready") emitted[0].onChoose("Approve");
    await promise;
  });

  it("falls back to ['continue'] when options is undefined", async () => {
    const { interviewer, emitted } = makeInterviewer();
    const promise = interviewer.ask({ type: "FREEFORM", prompt: "Go?" });
    expect(emitted[0].kind).toBe("gate-ready");
    if (emitted[0].kind === "gate-ready") {
      expect(emitted[0].options).toEqual(["continue"]);
      emitted[0].onChoose("continue");
    }
    await promise;
  });

  it("emits text event with chosen value when onChoose is called", async () => {
    const { interviewer, emitted } = makeInterviewer();
    const promise = interviewer.ask({
      type: "MULTIPLE_CHOICE",
      prompt: "Proceed?",
      options: ["Approve", "Decline"],
    });
    if (emitted[0].kind === "gate-ready") emitted[0].onChoose("Approve");
    await promise;

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual({ kind: "text", role: "you", text: "Approve" });
  });

  it("resolves the promise with the chosen value", async () => {
    const { interviewer, emitted } = makeInterviewer();
    const promise = interviewer.ask({
      type: "MULTIPLE_CHOICE",
      prompt: "Proceed?",
      options: ["Approve", "Decline"],
    });
    if (emitted[0].kind === "gate-ready") emitted[0].onChoose("Decline");
    const answer = await promise;
    expect(answer).toEqual({ value: "Decline" });
  });
});
