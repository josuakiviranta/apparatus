// src/cli/tests/interactions-agent-driver.test.ts
import { describe, it, expect, vi } from "vitest";
import { agentDriver, __agentStatesForTest } from "../lib/interactions/drivers/agent.js";
import type { LiveBlock } from "../lib/pipelineEvents.js";
import type { ChildHandle } from "../lib/agent.js";

function liveOf(id: string): LiveBlock {
  return {
    id,
    nodeId: "n",
    label: "l",
    kind: "interactive-agent",
    startedAt: 0,
    body: [],
    stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
  };
}

describe("agentDriver", () => {
  it("reduce stores child + onDone in the per-driver state map keyed by block id", () => {
    const live = liveOf("blk-1");
    const child = { kill: vi.fn() } as unknown as ChildHandle;
    const onDone = vi.fn();
    const next = agentDriver.reduce(
      { driver: "interactive-agent", kind: "agent.ready", child, onDone },
      live,
    );
    expect(next).toBe(live);
    const entry = __agentStatesForTest.get("blk-1");
    expect(entry?.child).toBe(child);
    expect(entry?.onDone).toBe(onDone);
    __agentStatesForTest.clear();
  });

  it("reduce ignores payloads addressed to a different driver", () => {
    const live = liveOf("blk-2");
    const next = agentDriver.reduce(
      {
        driver: "wait-human",
        kind: "gate.ready",
        options: ["x"],
        onChoose: () => {},
      },
      live,
    );
    expect(next).toBe(live);
    expect(__agentStatesForTest.get("blk-2")).toBeUndefined();
  });

  it("keymap.escape calls child.kill('SIGTERM')", () => {
    const live = liveOf("blk-3");
    const kill = vi.fn().mockResolvedValue(undefined);
    __agentStatesForTest.set("blk-3", {
      child: { kill } as unknown as ChildHandle,
      onDone: () => {},
    });
    agentDriver.keymap.escape(live);
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    __agentStatesForTest.clear();
  });

  it("keymap.escape is a no-op when no state exists for the block", () => {
    expect(() => agentDriver.keymap.escape(liveOf("missing"))).not.toThrow();
  });

  it("onFreeze surfaces onDone onto the partial Block and removes the state entry", () => {
    const live = liveOf("blk-4");
    const onDone = vi.fn();
    __agentStatesForTest.set("blk-4", {
      child: { kill: vi.fn() } as unknown as ChildHandle,
      onDone,
    });
    const partial = agentDriver.onFreeze!(live, { status: "success" });
    expect(partial.onDone).toBe(onDone);
    expect(__agentStatesForTest.get("blk-4")).toBeUndefined();
  });
});
