// src/cli/tests/compose-create-prompt.test.ts
import { describe, it, expect } from "vitest";
import { composeCreatePrompt } from "../lib/pipeline-create-prompt.js";

describe("composeCreatePrompt", () => {
  it("instructs authoring agent to declare cwd on tool nodes", () => {
    const prompt = composeCreatePrompt("/tmp");
    expect(prompt).toMatch(/cwd=/);
    expect(prompt).toMatch(/tool/i);
  });

  it("notes --project is required when \\$project is referenced", () => {
    const prompt = composeCreatePrompt("/tmp");
    expect(prompt).toMatch(/--project/);
  });
});
