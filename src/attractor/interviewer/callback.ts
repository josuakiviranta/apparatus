import type { Interviewer, Question, Answer } from "./index.js";

export class CallbackInterviewer implements Interviewer {
  constructor(private fn: (q: Question) => Promise<Answer>) {}
  async ask(q: Question): Promise<Answer> { return this.fn(q); }
}
