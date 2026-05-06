import { describe, it, expect } from "vitest";
import { isInteractiveAgent } from "../core/graph.js";
import type { Node } from "../types.js";

const node = (over: Partial<Node>): Node => ({ id: "n", ...over } as Node);

describe("isInteractiveAgent", () => {
  it("returns true for boolean true", () => {
    expect(isInteractiveAgent(node({ interactive: true }))).toBe(true);
  });

  it("returns true for string 'true'", () => {
    expect(isInteractiveAgent(node({ interactive: "true" }))).toBe(true);
  });

  it("returns false for boolean false", () => {
    expect(isInteractiveAgent(node({ interactive: false }))).toBe(false);
  });

  it("returns false for string 'false'", () => {
    expect(isInteractiveAgent(node({ interactive: "false" }))).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isInteractiveAgent(node({}))).toBe(false);
  });
});
