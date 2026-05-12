import { describe, it, expect } from "vitest";
import { InkInterviewer } from "../interviewer/ink.js";
import type { NodeEvent } from "../../cli/lib/pipelineEvents.js";

function makeInterviewer() {
  const emitted: NodeEvent[] = [];
  const emit = (e: NodeEvent) => emitted.push(e);
  const interviewer = new InkInterviewer(emit);
  return { interviewer, emitted };
}

describe("InkInterviewer", () => {
  it("emits driver-event/gate.ready with the provided options", async () => {
    const { interviewer, emitted } = makeInterviewer();
    // don't await — the promise is pending until onChoose is called
    const promise = interviewer.ask({
      type: "MULTIPLE_CHOICE",
      prompt: "Proceed?",
      options: ["Approve", "Decline"],
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].kind).toBe("driver-event");
    if (emitted[0].kind === "driver-event" && emitted[0].payload.driver === "wait-human") {
      expect(emitted[0].payload.options).toEqual(["Approve", "Decline"]);
      emitted[0].payload.onChoose("Approve");
    }
    await promise;
  });

  it("falls back to ['continue'] when options is undefined", async () => {
    const { interviewer, emitted } = makeInterviewer();
    const promise = interviewer.ask({ type: "FREEFORM", prompt: "Go?" });
    expect(emitted[0].kind).toBe("driver-event");
    if (emitted[0].kind === "driver-event" && emitted[0].payload.driver === "wait-human") {
      expect(emitted[0].payload.options).toEqual(["continue"]);
      emitted[0].payload.onChoose("continue");
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
    if (emitted[0].kind === "driver-event" && emitted[0].payload.driver === "wait-human") {
      emitted[0].payload.onChoose("Approve");
    }
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
    if (emitted[0].kind === "driver-event" && emitted[0].payload.driver === "wait-human") {
      emitted[0].payload.onChoose("Decline");
    }
    const answer = await promise;
    expect(answer).toEqual({ value: "Decline" });
  });

  it("recognises ABORT_CHOICE in onChoose and resolves Answer with the sentinel value", async () => {
    const { ABORT_CHOICE } = await import("../../cli/lib/interactions/drivers/gate.js");
    const { interviewer, emitted } = makeInterviewer();
    const promise = interviewer.ask({
      type: "MULTIPLE_CHOICE",
      prompt: "Proceed?",
      options: ["Approve"],
    });
    if (emitted[0].kind === "driver-event" && emitted[0].payload.driver === "wait-human") {
      emitted[0].payload.onChoose(ABORT_CHOICE);
    }
    const answer = await promise;
    expect(answer).toEqual({ value: ABORT_CHOICE });
    // No "you" text should be emitted on abort.
    expect(emitted.filter(e => e.kind === "text" && (e as { role: string }).role === "you")).toHaveLength(0);
  });
});
