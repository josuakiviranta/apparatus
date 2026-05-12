// src/cli/tests/interactions-gate-driver.test.ts
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import {
  gateDriver,
  ABORT_CHOICE,
  __gateStatesForTest,
} from "../lib/interactions/drivers/gate.js";
import type { LiveBlock } from "../lib/pipelineEvents.js";

function liveOf(id: string): LiveBlock {
  return {
    id,
    nodeId: "g",
    label: "Gate?",
    kind: "wait-human",
    startedAt: 0,
    body: [],
    stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
  };
}

describe("gateDriver", () => {
  it("ABORT_CHOICE is the module-scoped sentinel string", () => {
    expect(ABORT_CHOICE).toBe("__abort__");
  });

  it("reduce stores options + onChoose keyed by block id", () => {
    const live = liveOf("g-1");
    const onChoose = vi.fn();
    const next = gateDriver.reduce(
      {
        driver: "wait-human",
        kind: "gate.ready",
        options: ["A", "B"],
        onChoose,
      },
      live,
    );
    expect(next).toBe(live);
    const entry = __gateStatesForTest.get("g-1");
    expect(entry?.options).toEqual(["A", "B"]);
    expect(entry?.onChoose).toBe(onChoose);
    __gateStatesForTest.clear();
  });

  it("reduce ignores payloads addressed to a different driver", () => {
    const live = liveOf("g-2");
    const next = gateDriver.reduce(
      {
        driver: "interactive-agent",
        kind: "agent.ready",
        child: { kill: vi.fn() } as unknown as never,
        onDone: () => {},
      },
      live,
    );
    expect(next).toBe(live);
    expect(__gateStatesForTest.get("g-2")).toBeUndefined();
  });

  it("keymap.escape invokes onChoose(ABORT_CHOICE)", () => {
    const live = liveOf("g-3");
    const onChoose = vi.fn();
    __gateStatesForTest.set("g-3", { options: ["A"], onChoose });
    gateDriver.keymap.escape(live);
    expect(onChoose).toHaveBeenCalledWith(ABORT_CHOICE);
    __gateStatesForTest.clear();
  });

  it("keymap.escape is a no-op when no state exists for the block", () => {
    expect(() => gateDriver.keymap.escape(liveOf("missing"))).not.toThrow();
  });

  it("renderFooter returns null when no state is registered", () => {
    const live = liveOf("g-4");
    const { lastFrame } = render(
      React.createElement(() =>
        gateDriver.renderFooter(live, {
          inputBuffer: "",
          onInputChange: () => {},
          onInputSubmit: async () => {},
        }) as React.ReactElement | null,
      ) as never,
    );
    expect(lastFrame()).toBe("");
  });

  it("renderFooter mounts <GateSelector/> with stored options when state present", () => {
    const live = liveOf("g-5");
    __gateStatesForTest.set("g-5", { options: ["Yes", "No"], onChoose: vi.fn() });
    const { lastFrame } = render(
      React.createElement(() =>
        gateDriver.renderFooter(live, {
          inputBuffer: "",
          onInputChange: () => {},
          onInputSubmit: async () => {},
        }) as React.ReactElement | null,
      ) as never,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Yes");
    expect(out).toContain("No");
    __gateStatesForTest.clear();
  });
});
