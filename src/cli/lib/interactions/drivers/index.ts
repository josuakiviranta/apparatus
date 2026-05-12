// src/cli/lib/interactions/drivers/index.ts
import type { BlockKind } from "../../classifyNode.js";
import type { InteractionDriver } from "../driver.js";
import { agentDriver } from "./agent.js";
import { gateDriver } from "./gate.js";

function noopDriver<K extends BlockKind>(kind: K): InteractionDriver<K> {
  return {
    kind,
    initState: () => undefined,
    reduce: (_p, s) => s,
    renderFooter: () => null,
    keymap: { escape: () => {} },
  };
}

export const drivers = {
  "interactive-agent": agentDriver,
  "wait-human": gateDriver,
  agent: noopDriver("agent"),
  tool: noopDriver("tool"),
  store: noopDriver("store"),
  conditional: noopDriver("conditional"),
  marker: noopDriver("marker"),
} as const satisfies Record<BlockKind, InteractionDriver<BlockKind>>;
