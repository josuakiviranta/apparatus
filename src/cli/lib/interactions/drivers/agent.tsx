// src/cli/lib/interactions/drivers/agent.tsx
import React from "react";
import { Box, Text } from "ink";
import type { InteractionDriver, DriverPayload, DriverRenderCtx } from "../driver.js";
import type { LiveBlock, Block } from "../../pipelineEvents.js";
import type { ChildHandle } from "../../agent.js";
import { TextInput } from "../../../components/TextInput.js";

interface AgentState {
  child: ChildHandle;
  onDone: () => void;
}

const states = new Map<string, AgentState>();

// Exported for tests only — never imported by production code.
export const __agentStatesForTest = states;

export const agentDriver: InteractionDriver<"interactive-agent"> = {
  kind: "interactive-agent",
  initState: () => undefined,
  reduce(payload: DriverPayload, state: LiveBlock): LiveBlock {
    if (payload.driver !== "interactive-agent") return state;
    states.set(state.id, { child: payload.child, onDone: payload.onDone });
    return state;
  },
  renderFooter(block: LiveBlock, ctx: DriverRenderCtx) {
    return (
      <Box>
        <Text color="gray">{"> "}</Text>
        <TextInput
          prefixWidth={2}
          value={ctx.inputBuffer}
          onChange={ctx.onInputChange}
          onSubmit={ctx.onInputSubmit}
        />
      </Box>
    );
  },
  keymap: {
    escape: (block) => {
      const s = states.get(block.id);
      s?.child.kill("SIGTERM").catch(() => {});
    },
    help: "/end /abort /help · Esc to abort",
  },
  onFreeze(live): Partial<Block> {
    const s = states.get(live.id);
    states.delete(live.id);
    return s ? { onDone: s.onDone } : {};
  },
};
