import type { Interviewer, Question, Answer } from "./index.js";

export class QueueInterviewer implements Interviewer {
  private queue: string[];
  constructor(answers: string[]) { this.queue = [...answers]; }
  async ask(_q: Question): Promise<Answer> {
    if (this.queue.length === 0) throw new Error("QueueInterviewer: no more answers in queue");
    return { value: this.queue.shift()! };
  }
}
