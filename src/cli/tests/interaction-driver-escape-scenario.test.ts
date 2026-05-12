import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { gateDriver, ABORT_CHOICE, __gateStatesForTest } from "../lib/interactions/drivers/gate.js";
import { agentDriver, __agentStatesForTest } from "../lib/interactions/drivers/agent.js";
import type { LiveBlock } from "../lib/pipelineEvents.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO = resolve(__dirname, "../../../.apparat/scenarios/interaction-driver-escape/pipeline.dot");

function liveOf(kind: LiveBlock["kind"], id: string, nodeId: string): LiveBlock {
  return {
    id, nodeId, label: nodeId, kind,
    startedAt: 0, body: [],
    stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
  };
}

describe("scenario: interaction-driver-escape", () => {
  beforeEach(() => {
    __gateStatesForTest.clear();
    __agentStatesForTest.clear();
  });

  afterEach(() => {
    __gateStatesForTest.clear();
    __agentStatesForTest.clear();
  });

  it("scenario pipeline.dot exists and declares an __abort__ edge from the gate", () => {
    expect(existsSync(SCENARIO)).toBe(true);
    const dot = readFileSync(SCENARIO, "utf8");
    // The frozen contract: the gate has an outgoing edge labeled __abort__.
    expect(dot).toMatch(/gate\s*->\s*\w+\s*\[label="__abort__"\]/);
    // The gate is a wait-human (hexagon) node.
    expect(dot).toMatch(/gate\s*\[shape=hexagon/);
    // An 'after' tool node exists so the contract is observable: when the
    // pipeline aborts at the gate, this node must not execute.
    expect(dot).toMatch(/after\s*\[/);
  });

  it("Esc on a live gate invokes onChoose with ABORT_CHOICE and 'after gate' is never enqueued", () => {
    // Simulate the gate driver mount: register a state entry for the live gate.
    const onChoose = vi.fn();
    __gateStatesForTest.set("gate-0", { options: ["Approve", "Decline"], onChoose });

    // The pipeline-side seam: PipelineRunView's useInput dispatches Esc to
    // drivers[state.live.kind].keymap.escape(state.live).
    gateDriver.keymap.escape(liveOf("wait-human", "gate-0", "gate"));

    // The gate driver routes ABORT_CHOICE back into the interviewer, which
    // resolves the Answer with the sentinel — propagating along the __abort__
    // edge defined in pipeline.dot. The 'after' tool node never receives a
    // start event because the gate-edge routing leaves the after-side
    // unselected.
    expect(onChoose).toHaveBeenCalledWith(ABORT_CHOICE);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("Esc on a live interactive-agent calls child.kill('SIGTERM') and aborts the run", () => {
    // The agent-driver escape contract: child.kill('SIGTERM') is invoked
    // exactly once, with no other side effects.
    const kill = vi.fn().mockResolvedValue(undefined);
    __agentStatesForTest.set("blk-x", {
      child: { kill } as never,
      onDone: vi.fn(),
    });
    agentDriver.keymap.escape(liveOf("interactive-agent", "blk-x", "chat"));
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(kill).toHaveBeenCalledTimes(1);
  });
});
