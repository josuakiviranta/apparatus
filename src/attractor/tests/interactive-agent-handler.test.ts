import { describe, it, expect } from "vitest";
import { InteractiveAgentHandler } from "../handlers/interactive-agent-handler.js";

describe("InteractiveAgentHandler", () => {
  it("is a NodeHandler with execute() method", () => {
    const h = new InteractiveAgentHandler();
    expect(typeof h.execute).toBe("function");
  });
});
