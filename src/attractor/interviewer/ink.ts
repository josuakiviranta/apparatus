import type { Interviewer, Question, Answer } from "./index.js";
import type { NodeEvent } from "../../cli/lib/pipelineEvents.js";
import { ABORT_CHOICE } from "../../cli/lib/interactions/drivers/gate.js";

export class InkInterviewer implements Interviewer {
  constructor(private emit: (e: NodeEvent) => void) {}

  async ask(q: Question): Promise<Answer> {
    return new Promise((resolve) => {
      this.emit({
        kind: "driver-event",
        payload: {
          driver: "wait-human",
          kind: "gate.ready",
          options: q.options ?? ["continue"],
          onChoose: (choice) => {
            if (choice === ABORT_CHOICE) {
              this.emit({ kind: "text", role: "system", text: "(gate aborted)" });
              resolve({ value: ABORT_CHOICE });
              return;
            }
            this.emit({ kind: "text", role: "you", text: choice });
            resolve({ value: choice });
          },
        },
      });
    });
  }
}
