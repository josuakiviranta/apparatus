export type QuestionType = "YES_NO" | "MULTIPLE_CHOICE" | "FREEFORM" | "CONFIRMATION";

export interface Question {
  type: QuestionType;
  prompt: string;
  options?: string[];
}

export interface Answer {
  value: string;
}

export interface Interviewer {
  ask(question: Question): Promise<Answer>;
}
