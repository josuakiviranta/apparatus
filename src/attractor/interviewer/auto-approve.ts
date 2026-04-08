import type { Interviewer, Question, Answer } from "./index.js";

export class AutoApproveInterviewer implements Interviewer {
  async ask(q: Question): Promise<Answer> {
    if (q.type === "MULTIPLE_CHOICE") return { value: q.options?.[0] ?? "" };
    if (q.type === "YES_NO" || q.type === "CONFIRMATION") return { value: "yes" };
    return { value: "" };
  }
}
