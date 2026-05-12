// src/cli/tests/interactions-registry.test.ts
import { describe, it, expect } from "vitest";
import { drivers } from "../lib/interactions/drivers/index.js";
import type { InteractionDriver } from "../lib/interactions/driver.js";
import type { InteractionKind } from "../lib/classifyNode.js";

describe("drivers registry", () => {
  it("declares one driver per InteractionKind", () => {
    expect(Object.keys(drivers).sort()).toEqual(
      ["interactive-agent", "wait-human"].sort(),
    );
  });

  it("interactive-agent and wait-human are wired to the real drivers", async () => {
    const { agentDriver } = await import("../lib/interactions/drivers/agent.js");
    const { gateDriver } = await import("../lib/interactions/drivers/gate.js");
    expect(drivers["interactive-agent"]).toBe(agentDriver);
    expect(drivers["wait-human"]).toBe(gateDriver);
  });

  it("rejects non-InteractionKind keys at the type level", () => {
    // @ts-expect-error - 'tool' is not an InteractionKind; satisfies must reject it
    const _proof = {
      "interactive-agent": drivers["interactive-agent"],
      "wait-human": drivers["wait-human"],
      tool: drivers["interactive-agent"],
    } as const satisfies Record<InteractionKind, InteractionDriver<InteractionKind>>;
    void _proof;
  });
});
