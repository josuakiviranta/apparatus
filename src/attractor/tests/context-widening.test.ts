import { describe, it, expect } from "vitest";
import type { Outcome, CheckpointState } from "../types.js";

describe("Outcome.contextUpdates widened to unknown", () => {
  it("accepts string values (backwards compat)", () => {
    const o: Outcome = {
      status: "success",
      contextUpdates: { "k.s": "value" },
    };
    expect(o.contextUpdates!["k.s"]).toBe("value");
  });

  it("accepts number values", () => {
    const o: Outcome = {
      status: "success",
      contextUpdates: { "k.n": 42 },
    };
    expect(o.contextUpdates!["k.n"]).toBe(42);
  });

  it("accepts boolean values", () => {
    const o: Outcome = {
      status: "success",
      contextUpdates: { "k.b": true },
    };
    expect(o.contextUpdates!["k.b"]).toBe(true);
  });

  it("accepts object values", () => {
    const digest = { messageCount: 3, tools: [] as unknown[] };
    const o: Outcome = {
      status: "success",
      contextUpdates: { "k.o": digest },
    };
    expect(o.contextUpdates!["k.o"]).toEqual(digest);
  });

  it("CheckpointState.context accepts unknown values", () => {
    const state: CheckpointState = {
      timestamp: "2026-04-13T00:00:00.000Z",
      currentNode: "n1",
      completedNodes: [],
      nodeRetries: {},
      context: { "k.n": 42, "k.s": "v" },
    };
    expect(state.context["k.n"]).toBe(42);
  });
});
