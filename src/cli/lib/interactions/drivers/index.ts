// src/cli/lib/interactions/drivers/index.ts
import type { InteractionKind } from "../../classifyNode.js";
import type { InteractionDriver } from "../driver.js";
import { agentDriver } from "./agent.js";
import { gateDriver } from "./gate.js";

export const drivers = {
  "interactive-agent": agentDriver,
  "wait-human": gateDriver,
} as const satisfies Record<InteractionKind, InteractionDriver<InteractionKind>>;
