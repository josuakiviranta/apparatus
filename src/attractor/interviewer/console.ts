import { createInterface } from "readline";
import type { Interviewer, Question, Answer } from "./index.js";

export class ConsoleInterviewer implements Interviewer {
  async ask(q: Question): Promise<Answer> {
    if (!process.stdin.isTTY) {
      throw new Error("wait.human node requires an interactive TTY — cannot prompt in non-interactive context");
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      let prompt = q.prompt;
      if (q.type === "YES_NO") prompt += " [yes/no]: ";
      else if (q.type === "MULTIPLE_CHOICE" && q.options) {
        prompt += "\n" + q.options.map((o, i) => `  ${i + 1}. ${o}`).join("\n") + "\nChoice: ";
      } else if (q.type === "CONFIRMATION") prompt += " [yes/no]: ";
      else prompt += ": ";

      rl.question(prompt, (answer) => {
        rl.close();
        if (q.type === "MULTIPLE_CHOICE" && q.options) {
          const idx = parseInt(answer) - 1;
          resolve({ value: q.options[idx] ?? answer });
        } else {
          resolve({ value: answer.trim().toLowerCase() });
        }
      });
    });
  }
}
