import { describe, it, expect } from "vitest";
import { LoopingAgentHandler } from "../handlers/looping-agent-handler.js";

describe("LoopingAgentHandler", () => {
  it("is a NodeHandler with execute() method", () => {
    const h = new LoopingAgentHandler();
    expect(typeof h.execute).toBe("function");
  });
});
