import { describe, it, expect, vi } from "vitest";
import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
import { QueueInterviewer } from "../interviewer/queue.js";
import { CallbackInterviewer } from "../interviewer/callback.js";
import type { Question, Answer } from "../interviewer/index.js";

describe("AutoApproveInterviewer", () => {
  it("always returns first option for MULTIPLE_CHOICE", async () => {
    const i = new AutoApproveInterviewer();
    const q: Question = { type: "MULTIPLE_CHOICE", prompt: "Pick one", options: ["Yes", "No", "Redo"] };
    const a = await i.ask(q);
    expect(a.value).toBe("Yes");
  });

  it("returns yes for YES_NO", async () => {
    const i = new AutoApproveInterviewer();
    const a = await i.ask({ type: "YES_NO", prompt: "Continue?" });
    expect(a.value).toBe("yes");
  });

  it("returns empty string for FREEFORM", async () => {
    const i = new AutoApproveInterviewer();
    const a = await i.ask({ type: "FREEFORM", prompt: "Comments?" });
    expect(a.value).toBe("");
  });

  it("returns confirmed=true for CONFIRMATION", async () => {
    const i = new AutoApproveInterviewer();
    const a = await i.ask({ type: "CONFIRMATION", prompt: "Proceed?" });
    expect(a.value).toBe("yes");
  });
});

describe("QueueInterviewer", () => {
  it("returns queued answers in order", async () => {
    const i = new QueueInterviewer(["Yes", "No"]);
    const a1 = await i.ask({ type: "YES_NO", prompt: "Q1" });
    const a2 = await i.ask({ type: "YES_NO", prompt: "Q2" });
    expect(a1.value).toBe("Yes");
    expect(a2.value).toBe("No");
  });

  it("throws when queue is empty", async () => {
    const i = new QueueInterviewer([]);
    await expect(i.ask({ type: "YES_NO", prompt: "Q" })).rejects.toThrow();
  });
});

describe("CallbackInterviewer", () => {
  it("delegates to callback", async () => {
    const cb = vi.fn(async (_q: Question): Promise<Answer> => ({ value: "custom" }));
    const i = new CallbackInterviewer(cb);
    const a = await i.ask({ type: "FREEFORM", prompt: "Q" });
    expect(a.value).toBe("custom");
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Q" }));
  });
});
