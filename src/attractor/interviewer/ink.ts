import type { Interviewer, Question, Answer } from "./index.js";
import type { NodeEvent } from "../../cli/lib/pipelineEvents.js";

export class InkInterviewer implements Interviewer {
  constructor(private emit: (e: NodeEvent) => void) {}

  async ask(q: Question): Promise<Answer> {
    return new Promise((resolve) => {
      this.emit({
        kind: "gate-ready",
        options: q.options ?? ["continue"],
        onChoose: (choice) => {
          this.emit({ kind: "text", role: "you", text: choice });
          resolve({ value: choice });
        },
      });
    });
  }
}
