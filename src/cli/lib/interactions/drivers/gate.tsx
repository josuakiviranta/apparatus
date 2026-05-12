import React from "react";
import type { InteractionDriver, DriverPayload } from "../driver.js";
import type { LiveBlock } from "../../pipelineEvents.js";
import { GateSelector } from "../../../components/GateSelector.js";

interface GateState {
  options: string[];
  onChoose: (choice: string) => void;
}

const states = new Map<string, GateState>();

// Exported for tests only.
export const __gateStatesForTest = states;

export const ABORT_CHOICE = "__abort__";

export const gateDriver: InteractionDriver<"wait-human"> = {
  kind: "wait-human",
  initState: () => undefined,
  reduce(payload: DriverPayload, state: LiveBlock): LiveBlock {
    if (payload.driver !== "wait-human") return state;
    states.set(state.id, {
      options: payload.options,
      onChoose: payload.onChoose,
    });
    return state;
  },
  renderFooter(block: LiveBlock) {
    const s = states.get(block.id);
    if (!s) return null;
    return <GateSelector options={s.options} onChoose={s.onChoose} />;
  },
  keymap: {
    escape: (block) => {
      const s = states.get(block.id);
      s?.onChoose(ABORT_CHOICE);
    },
    help: "↑↓ · Enter / 1-N · Esc to abort",
  },
};
