// src/cli/tests/interactions-registry.test.ts
import { describe, it, expect } from "vitest";
import { drivers } from "../lib/interactions/drivers/index.js";

describe("drivers registry", () => {
  it("declares one driver per BlockKind", () => {
    expect(Object.keys(drivers).sort()).toEqual(
      [
        "agent",
        "conditional",
        "interactive-agent",
        "marker",
        "store",
        "tool",
        "wait-human",
      ].sort(),
    );
  });

  it("non-interactive kinds expose a noop renderFooter and escape", () => {
    for (const kind of ["agent", "tool", "store", "conditional", "marker"] as const) {
      const d = drivers[kind];
      expect(d.kind).toBe(kind);
      expect(
        d.renderFooter(
          {
            id: "x",
            nodeId: "x",
            label: "x",
            kind,
            startedAt: 0,
            body: [],
            stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
          },
          { inputBuffer: "", onInputChange: () => {}, onInputSubmit: async () => {} },
        ),
      ).toBeNull();
      expect(() =>
        d.keymap.escape({
          id: "x",
          nodeId: "x",
          label: "x",
          kind,
          startedAt: 0,
          body: [],
          stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
        }),
      ).not.toThrow();
    }
  });

  it("interactive-agent and wait-human are wired to the real drivers", async () => {
    const { agentDriver } = await import("../lib/interactions/drivers/agent.js");
    const { gateDriver } = await import("../lib/interactions/drivers/gate.js");
    expect(drivers["interactive-agent"]).toBe(agentDriver);
    expect(drivers["wait-human"]).toBe(gateDriver);
  });
});
