import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../lib/frontmatter.js";
import { validateAgentConfig } from "../lib/agent.js";

describe("parseFrontmatter — inputs block", () => {
  it("parses inputs: as a string array", () => {
    const input = `---
name: a
inputs:
  - illumination_path
  - refinements
  - run_id
---
body`;
    const { attributes } = parseFrontmatter(input);
    expect(attributes.inputs).toEqual(["illumination_path", "refinements", "run_id"]);
  });

  it("returns no inputs key when frontmatter omits it", () => {
    const { attributes } = parseFrontmatter(`---
name: a
---
body`);
    expect(attributes.inputs).toBeUndefined();
  });
});

describe("validateAgentConfig — inputs", () => {
  it("attaches inputs array to AgentConfig", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent", model: "sonnet",
      inputs: ["foo", "bar"],
      prompt: "",
    } as any);
    expect(config.inputs).toEqual(["foo", "bar"]);
  });

  it("does not set inputs when absent", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent", model: "sonnet",
      prompt: "",
    } as any);
    expect(config.inputs).toBeUndefined();
  });

  it("treats empty inputs array as valid (zero-input agent)", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent", model: "sonnet",
      inputs: [],
      prompt: "",
    } as any);
    expect(config.inputs).toEqual([]);
  });
});
